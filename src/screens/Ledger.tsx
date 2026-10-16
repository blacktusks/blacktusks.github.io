import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { itemImageUrl, supabase } from '../lib/supabase';
import { isHerald } from '../lib/roles';
import { autoAcquire, autoUses, customItems, itemPictureUrl, loadDetails, loadItems, type Cat, type Detail, type Item } from '../lib/catalog';
import { cutout, type Cutout } from '../lib/cutout';
import type { LedgerEntry } from '../lib/types';
import { Scene } from '../components/Scene';
import { Confirm, Modal, num, useTitle } from '../components/ui';

type CatId = 'fav' | 'all' | Cat;
const ICON: Record<CatId, string> = {
  fav: 'M12 2.6l2.8 6 6.6.7-4.9 4.4 1.4 6.5L12 16.9 6.1 20.2l1.4-6.5L2.6 9.3l6.6-.7z',
  all: 'M4 5h16v3H4zm0 5.5h16v3H4zM4 16h16v3H4z',
  weapons: 'M19.8 2.2l2 2-9.2 9.2 1.5 1.5-1.4 1.4-1.6-1.6-4.3 4.3 1 1-1.4 1.4-1.8-1.8-1.5 1.5-1.4-1.4 1.5-1.5-1.8-1.8 1.4-1.4 1 1 4.3-4.3-1.6-1.6L8 8.7l1.5 1.5z',
  apparel: 'M8.5 3l3.5 2 3.5-2 5 3.2-2.2 4-1.8-1V21h-9V9.2l-1.8 1-2.2-4z',
  potions: 'M9.5 2.5h5v2h-1v3.6c2.9 1 5 3.7 5 6.9 0 4-3 6.5-6.5 6.5S5.5 19 5.5 15c0-3.2 2.1-5.9 5-6.9V4.5h-1zm-1.8 12.5c0 2.4 1.8 4.3 4.3 4.3s4.3-1.9 4.3-4.3z',
  scrolls: 'M5 4.5c0-1.1.9-2 2-2h11c1.1 0 2 .9 2 2v13c0 2.2-1.8 4-4 4H7c-1.7 0-3-1.3-3-3v-1.5h9.5v1.5c0 .8.7 1.5 1.5 1.5s1.5-.7 1.5-1.5V6H7c-.5 0-1 .4-1 1v7.5H5zM8.5 8.5h6v1.5h-6zm0 3h6V13h-6z',
  food: 'M12 6.2c1.3-1.5 3-2.2 4.7-1.8 2.7.6 4 3.5 3.5 6.7-.6 4-3 8.4-5.8 8.4-.9 0-1.6-.4-2.4-.4s-1.5.4-2.4.4c-2.8 0-5.2-4.4-5.8-8.4-.5-3.2.8-6.1 3.5-6.7 1.7-.4 3.4.3 4.7 1.8zm.2-.7c-.2-1.7.6-3.3 2.3-4 .2 1.7-.6 3.3-2.3 4z',
  ingredients: 'M20.5 3.5c.3 6.5-1.7 11.2-6 13.2-1.8.8-3.7.9-5.5.4L6 20.5 4.5 19l2.9-3.5c-.9-2.4-.5-5.1 1.4-7.3C11.3 5.3 15.2 3.8 20.5 3.5zM9.5 14.5c3-2.8 5.5-5.2 8-8-3 1.7-5.8 4-8 8z',
  books: 'M5 3h12.5c.8 0 1.5.7 1.5 1.5V21H7c-1.7 0-3-1.3-3-3V4c0-.6.4-1 1-1zm2 13.5c-.6 0-1 .4-1 1s.4 1 1 1h10v-2zM8 6v1.8h8V6z',
  misc: 'M9 2.5h6l-1.2 3.2c3.4 1.4 5.7 5 5.7 9 0 4-3 6.8-7.5 6.8S4.5 18.7 4.5 14.7c0-4 2.3-7.6 5.7-9z',
};
const CATS: [CatId, string][] = [['fav', 'Favorites'], ['all', 'All'], ['weapons', 'Weapons'], ['apparel', 'Apparel'], ['potions', 'Potions'],
  ['scrolls', 'Scrolls'], ['food', 'Food'], ['ingredients', 'Ingredients'], ['books', 'Books'], ['misc', 'Misc']];
const Glyph = ({ id, size = 24 }: { id: CatId; size?: number }) => (<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={ICON[id]} /></svg>);

type SortKey = 'name' | 'type' | 'stat' | 'weight' | 'value' | 'tier' | 'price';
const ROW = 36;
const FAV_KEY = 'black-tusk-ledger-favorites';
const readFavs = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); } };

/** The picture on an item's card: one the clan uploaded, else the one rendered from the game model, else the category mark. */
function ItemPicture({ item, uploaded }: { item: Item; uploaded: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = uploaded ? itemImageUrl(uploaded) : item.pic && !failed ? itemPictureUrl(item.pic) : null;
  if (!src) return <span className="icard__ghost"><Glyph id={item.cat} size={120} /></span>;
  return <img src={src} alt={item.name} className={uploaded ? '' : 'is-render'} decoding="async" onError={() => setFailed(true)} />;
}

function statLabel(i: Item) { return i.cat === 'weapons' ? 'Damage' : i.cat === 'apparel' ? 'Armor' : ''; }

function EntryEditor({ item, entry, detail, onClose, onSaved }: { item: Item; entry: LedgerEntry | undefined; detail: Detail | undefined; onClose: () => void; onSaved: () => void }) {
  const [tier, setTier] = useState(entry?.tier ? String(entry.tier) : ''); const [price, setPrice] = useState(entry?.price != null ? String(entry.price) : '');
  const [priceNote, setPriceNote] = useState(entry?.price_note ?? ''); const [uses, setUses] = useState(entry?.uses ?? ''); const [acquire, setAcquire] = useState(entry?.acquire ?? '');
  const [hidden, setHidden] = useState(entry?.hidden ?? false); const [imagePath, setImagePath] = useState(entry?.image_path ?? null);
  const [file, setFile] = useState<File | null>(null); const [cut, setCut] = useState<Cutout | null>(null);
  const [remove, setRemove] = useState(true); const [tolerance, setTolerance] = useState(28);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!file) { setCut(null); return; }
    let live = true;
    cutout(file, { remove, tolerance }).then((c) => { if (live) setCut(c); else URL.revokeObjectURL(c.url); }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [file, remove, tolerance]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      let path = imagePath;
      if (cut) {
        path = `${item.key.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}.png`;
        const up = await supabase.storage.from('item-images').upload(path, cut.blob, { contentType: 'image/png', upsert: true });
        if (up.error) throw new Error(up.error.message);
        if (entry?.image_path) void supabase.storage.from('item-images').remove([entry.image_path]);
      } else if (!path && entry?.image_path) void supabase.storage.from('item-images').remove([entry.image_path]);
      const row = { item_key: item.key, tier: tier ? Number(tier) : null, price: price === '' ? null : Math.max(0, Math.round(Number(price))),
        price_note: priceNote.trim(), uses: uses.trim(), acquire: acquire.trim(), hidden, image_path: path, custom: entry?.custom ?? null };
      const { error } = await supabase.from('ledger_entries').upsert(row);
      if (error) throw new Error(error.message);
      onSaved(); onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  if (clearing) {
    return (
      <Confirm title={item.custom ? 'Remove this item' : 'Reset this item'} action={item.custom ? 'Remove' : 'Reset'} danger onClose={() => setClearing(false)}
        onConfirm={async () => { if (entry?.image_path) await supabase.storage.from('item-images').remove([entry.image_path]); await supabase.from('ledger_entries').delete().eq('item_key', item.key); onSaved(); onClose(); }}>
        <p>{item.custom ? `${item.name} will be removed from the ledger.` : `${item.name} goes back to unknown tier and unknown price, and loses its picture and notes.`}</p>
      </Confirm>
    );
  }
  const shown = cut?.url ?? (imagePath ? itemImageUrl(imagePath) : null);
  return (
    <Modal title={item.name} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <label className="field" style={{ width: 150 }}><span>Tier</span>
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">Unknown</option>{[1, 2, 3, 4, 5].map((t) => <option key={t} value={t}>Tier {t}{t === 1 ? ' (worst)' : t === 5 ? ' (best)' : ''}</option>)}
            </select>
          </label>
          <label className="field" style={{ width: 150 }}><span>Clan price</span>
            <input type="number" min={0} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Unknown" />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 180 }}><span>Price note</span>
            <input type="text" value={priceNote} onChange={(e) => setPriceNote(e.target.value)} maxLength={200} placeholder="Per ingot, allies pay less…" />
          </label>
        </div>
        <label className="field"><span>What it is used for</span>
          <textarea value={uses} onChange={(e) => setUses(e.target.value)} rows={3} maxLength={1200} style={{ minHeight: 84 }} placeholder={autoUses(item, detail) || 'Leave blank to use what the game files say.'} />
          <small>Leave blank to show what the game files say.</small>
        </label>
        <label className="field"><span>How to get it</span>
          <textarea value={acquire} onChange={(e) => setAcquire(e.target.value)} rows={3} maxLength={1200} style={{ minHeight: 84 }} placeholder={autoAcquire(item, detail).text} />
        </label>
        <span className="label">Picture</span>
        <div className="imgedit">
          <div className="imgedit__view">{shown ? <img src={shown} alt="" /> : item.pic ? <img src={itemPictureUrl(item.pic)} alt="" title="The picture made from the game model. Upload one to replace it." /> : <span className="muted small">No picture</span>}</div>
          <div className="imgedit__tools">
            <input type="file" accept="image/*" aria-label="Choose a picture" onChange={(e) => { setError(''); setFile(e.target.files?.[0] ?? null); }} />
            {file && <>
              <label className="check small"><input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />Remove the background</label>
              {remove && <label className="small">How much to remove
                <input type="range" min={6} max={90} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} style={{ width: '100%' }} /></label>}
              {cut && remove && !cut.removed && <p className="hint">No plain background found to remove. Try a higher setting, or a picture with a flat backdrop.</p>}
            </>}
            {(imagePath || file) && <button type="button" className="btn btn--small" onClick={() => { setFile(null); setImagePath(null); }}>Remove picture</button>}
          </div>
        </div>
        <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Hide from members (not obtainable on the server)</label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 14 }}>
          {entry && <button type="button" className="btn btn--danger" onClick={() => setClearing(true)}>{item.custom ? 'Remove item' : 'Reset'}</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--go" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddItem({ onClose, onSaved }: { onClose: () => void; onSaved: (key: string) => void }) {
  const [name, setName] = useState(''); const [cat, setCat] = useState<Cat>('misc'); const [type, setType] = useState('');
  const [value, setValue] = useState(''); const [weight, setWeight] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const key = `custom:${crypto.randomUUID()}`;
    const { error } = await supabase.from('ledger_entries').insert({ item_key: key, custom: { name: name.trim(), cat, type: type.trim() || 'Misc', value: Number(value) || 0, weight: Number(weight) || 0 } });
    setBusy(false);
    if (error) return setError(error.message);
    onSaved(key); onClose();
  };
  return (
    <Modal title="Add an item" onClose={onClose}>
      <form onSubmit={save}>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>For anything the server has that is missing from the ledger.</p>
        <label className="field"><span>Name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus /></label>
        <div className="row">
          <label className="field" style={{ flex: 1, minWidth: 150 }}><span>Category</span>
            <select value={cat} onChange={(e) => setCat(e.target.value as Cat)}>{CATS.slice(2).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
          <label className="field" style={{ flex: 1, minWidth: 150 }}><span>Type</span><input type="text" value={type} onChange={(e) => setType(e.target.value)} maxLength={30} placeholder="Sword, Ingot, Food…" /></label>
        </div>
        <div className="row">
          <label className="field" style={{ flex: 1 }}><span>Base value</span><input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} /></label>
          <label className="field" style={{ flex: 1 }}><span>Weight</span><input type="number" min={0} step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row row--end"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn--go" disabled={busy}>Add item</button></div>
      </form>
    </Modal>
  );
}

export default function Ledger() {
  useTitle('Pricing Ledger');
  const { profile } = useAuth(); const herald = isHerald(profile!.tags);
  const [params, setParams] = useSearchParams();
  const [base, setBase] = useState<Item[] | null>(null); const [details, setDetails] = useState<Record<string, Detail> | null>(null);
  const [detailsFailed, setDetailsFailed] = useState(false);
  const [entries, setEntries] = useState<LedgerEntry[]>([]); const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [cat, setCat] = useState<CatId>('all'); const [search, setSearch] = useState(''); const [type, setType] = useState(''); const [source, setSource] = useState('');
  const [pricedOnly, setPricedOnly] = useState(false); const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [picked, setPicked] = useState<string | null>(params.get('item'));
  const [favs, setFavs] = useState<Set<string>>(readFavs);
  const [editing, setEditing] = useState(false); const [adding, setAdding] = useState(false); const [error, setError] = useState('');
  const [scroll, setScroll] = useState(0); const [viewH, setViewH] = useState(600); const [cardOpen, setCardOpen] = useState(!!params.get('item'));
  const listRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null); const swipeRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; t: number; dx: number; live: boolean } | null>(null);
  const [slide, setSlide] = useState<'next' | 'prev' | ''>('');

  const loadEntries = useCallback(async () => {
    const { data, error } = await supabase.from('ledger_entries').select('*');
    if (error) setError('Could not load the clan’s prices. Check your connection and try again.'); else { setError(''); setEntries(data as LedgerEntry[]); }
    const hidden = await supabase.rpc('hidden_item_keys');
    if (!hidden.error) setHiddenKeys(new Set((hidden.data as string[]) ?? []));
  }, []);
  // The recipes come in a file of their own. Until it is in, no card may call an item "found".
  const fetchDetails = useCallback(() => { setDetailsFailed(false); loadDetails().then(setDetails).catch(() => setDetailsFailed(true)); }, []);
  useEffect(() => {
    loadItems().then(setBase).catch(() => setError('Could not load the item list. Check your connection and try again.'));
    fetchDetails();
    void loadEntries();
  }, [loadEntries, fetchDetails]);
  // An app left open in the background may have missed it: try again when it comes back to the front.
  useEffect(() => {
    if (!detailsFailed) return;
    const back = () => { if (document.visibilityState === 'visible') fetchDetails(); };
    document.addEventListener('visibilitychange', back); window.addEventListener('online', back);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('online', back); };
  }, [detailsFailed, fetchDetails]);
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight)); ro.observe(el); setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, [base]);

  const entry = useMemo(() => new Map(entries.map((e) => [e.item_key, e])), [entries]);
  const items = useMemo(() => (base ? [...base, ...customItems(entries)] : []), [base, entries]);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);

  const inCat = useMemo(() => items.filter((i) => {
    if (cat === 'fav') return favs.has(i.key);
    return cat === 'all' || i.cat === cat;
  }), [items, cat, favs]);
  const types = useMemo(() => [...new Set(inCat.map((i) => i.type))].sort(), [inCat]);
  const sources = useMemo(() => [...new Set(inCat.map((i) => i.src))].sort(), [inCat]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = inCat.filter((i) => {
      const e = entry.get(i.key);
      if (hiddenKeys.has(i.key) && !(herald && showHidden) && !(herald && i.key === picked)) return false;
      if (type && i.type !== type) return false;
      if (source && i.src !== source) return false;
      if (pricedOnly && e?.price == null) return false;
      return !q || i.lower.includes(q);
    });
    const k = sort.key, dir = sort.dir;
    const val = (i: Item): number | string | null => {
      if (k === 'name') return i.lower; if (k === 'type') return i.type + i.cls;
      if (k === 'stat') return i.stat; if (k === 'weight') return i.weight; if (k === 'value') return i.value;
      const e = entry.get(i.key); return k === 'tier' ? e?.tier ?? null : e?.price ?? null;
    };
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return a.lower < b.lower ? -1 : 1;
      if (x == null) return 1; if (y == null) return -1;       // unknowns always last
      return x < y ? -dir : x > y ? dir : a.lower < b.lower ? -1 : 1;
    });
  }, [inCat, entry, hiddenKeys, herald, showHidden, type, source, pricedOnly, search, sort, picked]);

  useEffect(() => { setType(''); setSource(''); listRef.current?.scrollTo(0, 0); }, [cat]);
  useEffect(() => { listRef.current?.scrollTo(0, 0); }, [search, type, source, pricedOnly, sort]);

  // deep link from the Mining Map: scroll the picked item into view once
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !picked || !rows.length || !params.get('item')) return;
    const at = rows.findIndex((r) => r.key === picked);
    if (at >= 0) { listRef.current?.scrollTo(0, Math.max(0, at * ROW - 120)); jumped.current = true; setParams({}, { replace: true }); }
  }, [rows, picked, params, setParams]);

  // Back at the list (on a phone the card covers it): bring the item last looked at into view.
  useEffect(() => {
    if (cardOpen || !picked) return;
    const el = listRef.current; const i = rows.findIndex((r) => r.key === picked);
    if (!el || i < 0) return;
    const top = i * ROW; if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 2 + ROW);
  }, [cardOpen]);   // eslint-disable-line react-hooks/exhaustive-deps

  const current = picked ? byKey.get(picked) : undefined;
  // Stepping through the list from the open card: a swipe on a phone, or the arrows above the picture.
  const at = current ? rows.findIndex((r) => r.key === current.key) : -1;
  const step = (d: 1 | -1) => {
    const n = at + d;
    if (at < 0 || n < 0 || n >= rows.length) return false;
    setSlide(d > 0 ? 'next' : 'prev'); setPicked(rows[n].key); cardRef.current?.scrollTo(0, 0);
    return true;
  };
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) { touch.current = null; return; }
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp, dx: 0, live: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touch.current; if (!s) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.live) {                                   // wait until the finger has plainly gone sideways; up and down is the card scrolling
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.3) { if (Math.abs(dy) > 14) touch.current = null; return; }
      s.live = true;
    }
    s.dx = dx;
    const el = swipeRef.current; if (!el) return;
    const end = (dx < 0 && at >= rows.length - 1) || (dx > 0 && at <= 0);     // nothing further that way: the card only gives a little
    el.style.transition = 'none'; el.style.transform = `translate3d(${end ? dx * 0.22 : dx}px, 0, 0)`; el.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 420));
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current; touch.current = null;
    if (!s || !s.live) return;
    const far = Math.abs(s.dx) > Math.min(110, window.innerWidth * 0.22), quick = Math.abs(s.dx) > 30 && Math.abs(s.dx) / Math.max(1, e.timeStamp - s.t) > 0.45;
    const moved = (far || quick) && step(s.dx < 0 ? 1 : -1);
    const el = swipeRef.current; if (!el) return;
    el.style.transition = moved ? 'none' : 'transform 0.2s ease, opacity 0.2s ease'; el.style.transform = ''; el.style.opacity = '';
  };
  const cur = current ? entry.get(current.key) : undefined;
  const det = current ? details?.[current.key] : undefined;
  const acq = current && details ? autoAcquire(current, det) : null;       // null until the recipes are in
  const toggleFav = (key: string) => setFavs((f) => { const n = new Set(f); n.has(key) ? n.delete(key) : n.add(key); try { localStorage.setItem(FAV_KEY, JSON.stringify([...n])); } catch { /* private mode */ } return n; });
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' || key === 'type' ? 1 : -1 }));
  const Th = ({ k, children, className = '' }: { k: SortKey; children: string; className?: string }) => (
    <button className={`lh ${className} ${sort.key === k ? 'is-on' : ''}`} onClick={() => sortBy(k)} aria-label={`Sort by ${children}`}>
      {children}{sort.key === k && <i>{sort.dir === 1 ? '▲' : '▼'}</i>}</button>
  );

  const first = Math.max(0, Math.floor(scroll / ROW) - 6), last = Math.min(rows.length, Math.ceil((scroll + viewH) / ROW) + 6);
  const priced = entries.filter((e) => e.price != null).length;
  const statHead = cat === 'weapons' ? 'Dmg' : cat === 'apparel' ? 'Arm' : 'Stat';

  return (
    <>
      <Scene quiet />
      <div className={`page ledger ${cardOpen && current ? 'has-card' : ''}`}>
        <section className="ledger__list" aria-label="Items">
          <nav className="lcats" aria-label="Categories">
            {CATS.map(([id, label]) => (
              <button key={id} className={`lcats__one ${cat === id ? 'is-on' : ''}`} aria-pressed={cat === id} title={label} aria-label={label} onClick={() => setCat(id)}><Glyph id={id} /></button>
            ))}
          </nav>
          <div className="lbar">
            <h1 className="lbar__title">{CATS.find((c) => c[0] === cat)![1]}</h1>
            <input className="lbar__search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter" aria-label="Filter by name" />
          </div>
          <div className="lfilters">
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">Any type</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source"><option value="">Any source</option>{sources.map((t) => <option key={t}>{t}</option>)}</select>
            <label className="check small"><input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} />Priced</label>
            {herald && <label className="check small"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />Hidden</label>}
          </div>
          <div className="lhead" role="row">
            <Th k="name" className="lc-name">Name</Th><Th k="type" className="lc-type">Type</Th><Th k="stat" className="lc-num lc-stat">{statHead}</Th>
            <Th k="weight" className="lc-num lc-wgt">Wgt</Th><Th k="value" className="lc-num lc-val">Val</Th><Th k="tier" className="lc-num lc-tier">Tier</Th><Th k="price" className="lc-num lc-price">Clan price</Th>
          </div>
          <div className="lrows" ref={listRef} onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)} role="listbox" aria-label="Items" tabIndex={0}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault();
              const at = rows.findIndex((r) => r.key === picked); const next = Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
              if (rows[next]) { setPicked(rows[next].key); const top = next * ROW; const el = listRef.current!; if (top < el.scrollTop) el.scrollTop = top; else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight; }
            }}>
            {error && <p className="error" role="alert" style={{ margin: 12 }}>{error}</p>}
            {!base && !error && <p className="empty">Opening the ledger…</p>}
            {base && rows.length === 0 && <p className="empty">{cat === 'fav' && !favs.size ? 'No favorites yet. Open an item and mark it with the star.' : 'Nothing matches. Clear the filter or try another category.'}</p>}
            <div style={{ height: rows.length * ROW, position: 'relative' }}>
              {rows.slice(first, last).map((i, n) => {
                const e = entry.get(i.key);
                return (
                  <button key={i.key} role="option" aria-selected={picked === i.key} className={`lrow ${picked === i.key ? 'is-on' : ''} ${e?.hidden ? 'is-hidden' : ''}`}
                    style={{ top: (first + n) * ROW }} onClick={() => { setSlide(''); setPicked(i.key); setCardOpen(true); }}>
                    <span className="lc-name"><span className="lrow__icon"><Glyph id={i.cat} size={17} /></span>{i.name}{favs.has(i.key) && <span className="lrow__fav" aria-label="Favorite">★</span>}</span>
                    <span className="lc-type">{i.type}{i.cls ? `, ${i.cls}` : ''}</span>
                    <span className="lc-num lc-stat">{i.stat ?? ''}</span><span className="lc-num lc-wgt">{i.weight || ''}</span><span className="lc-num lc-val">{num(i.value)}</span>
                    <span className="lc-num lc-tier">{e?.tier ?? <em>?</em>}</span><span className="lc-num lc-price">{e?.price != null ? num(e.price) : <em>Unknown</em>}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="ledger__card" aria-label="Item" ref={cardRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
          {!current ? <p className="empty">Pick an item to see its tier, price and how to get it.</p> : (
            <>
              {at >= 0 && rows.length > 1 && (
                <div className="icard__pager">
                  <button className="is-prev" aria-label="Previous item" disabled={at <= 0} onClick={() => step(-1)} />
                  <span>{num(at + 1)} of {num(rows.length)}</span>
                  <button className="is-next" aria-label="Next item" disabled={at >= rows.length - 1} onClick={() => step(1)} />
                </div>
              )}
              <div className={`icard__swipe ${slide ? `is-${slide}` : ''}`} key={current.key} ref={swipeRef}>
              <div className="icard__view">
                <ItemPicture key={current.key} item={current} uploaded={cur?.image_path ?? null} />
              </div>
              <div className="icard">
                <h2 className="icard__name">{current.name}</h2>
                <dl className="icard__stats">
                  {current.stat != null && statLabel(current) && <div><dt>{statLabel(current)}</dt><dd>{current.stat}</dd></div>}
                  <div><dt>Weight</dt><dd>{current.weight}</dd></div><div><dt>Value</dt><dd>{num(current.value)}</dd></div>
                </dl>
                <div className="icard__clan">
                  <div className={cur?.tier ? '' : 'is-unknown'}><span>{cur?.tier ? `Tier ${cur.tier}` : 'Unknown tier'}</span></div>
                  <div className={cur?.price != null ? '' : 'is-unknown'}><span>{cur?.price != null ? `${num(cur.price)} septims` : 'Price unknown'}</span>{cur?.price_note && <small>{cur.price_note}</small>}</div>
                </div>
                <p className="icard__type">{current.type}{current.cls ? `, ${current.cls}` : ''} from {current.src}{cur?.hidden ? '. Hidden from members' : ''}</p>
                <h3 className="icard__h">Used for</h3>
                <p>{cur?.uses || autoUses(current, det) || 'Nothing recorded yet.'}</p>
                <h3 className="icard__h">How to get it {(cur?.acquire || acq) && <span className={`stamp2 ${cur?.acquire ? '' : acq?.made ? 'is-made' : ''}`}>{cur?.acquire ? 'Clan note' : acq?.made ? 'Made' : 'Found'}</span>}</h3>
                {cur?.acquire || acq ? <p>{cur?.acquire || acq?.text}</p>
                  : detailsFailed ? <p className="icard__missing">The forge records did not load, so how this item is made is not shown. <button className="btn btn--small" onClick={fetchDetails}>Try again</button></p>
                  : <p className="muted">Reading the forge records…</p>}
                <div className="row" style={{ marginTop: 14 }}>
                  <button className="btn btn--small" aria-pressed={favs.has(current.key)} onClick={() => toggleFav(current.key)}>{favs.has(current.key) ? '★ Favorite' : '☆ Favorite'}</button>
                  {herald && <button className="btn btn--small btn--go" onClick={() => setEditing(true)}>Edit</button>}
                  <button className="btn btn--small ledger__close" onClick={() => setCardOpen(false)}>Back to list</button>
                </div>
              </div>
              </div>
            </>
          )}
        </section>

        <footer className="ledger__bar">
          <Link to="/" className="btn btn--small back">Back</Link>
          {herald && <button className="btn btn--small" onClick={() => setAdding(true)}>Add an item</button>}
          <span className="spacer" />
          <span className="ledger__count"><b>{num(rows.length)}</b> shown</span>
          <span className="ledger__count"><b>{num(priced)}</b> priced</span>
        </footer>
      </div>
      {editing && current && <EntryEditor item={current} entry={cur} detail={det} onClose={() => setEditing(false)} onSaved={loadEntries} />}
      {adding && <AddItem onClose={() => setAdding(false)} onSaved={(key) => { void loadEntries(); setCat('all'); setPicked(key); setCardOpen(true); }} />}
    </>
  );
}
