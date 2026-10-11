import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { dataUrl } from '../config';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { isHerald } from '../lib/roles';
import { KIND, KINDS, ORE, ORES } from '../lib/ores';
import { PROFILE_COLUMNS, type OreMarker, type Profile } from '../lib/types';
import { Scene } from '../components/Scene';
import { Confirm, ago, useTitle } from '../components/ui';

interface Geo { x0: number; y1: number; px_per_cell: number; w: number; h: number; max_zoom: number }
type Place = [name: string, type: string, x: number, y: number, server: number];
const MAJOR = new Set(['City', 'Town', 'Orc Stronghold', 'Settlement']);
const CELL = 4096;

function oreIcon(m: Pick<OreMarker, 'ore' | 'status'>, picked = false) {
  const o = ORE[m.ore];
  return L.divIcon({
    className: `ore ore--${m.status} ${picked ? 'is-picked' : ''}`, iconSize: [30, 30], iconAnchor: [15, 15],
    html: `<span style="--c:${o?.color ?? '#999'};--k:${o?.ink ?? '#000'}"><b>${o?.code ?? '?'}</b></span>`,
  });
}

interface Draft { id?: string; x: number; y: number; ore: string; kind: OreMarker['kind']; place: string; note: string; veins: number }

function nearest(places: Place[], x: number, y: number): Place | null {
  let best: Place | null = null, d = Infinity;
  for (const p of places) { const dd = (p[2] - x) ** 2 + (p[3] - y) ** 2; if (dd < d) { d = dd; best = p; } }
  return best && Math.sqrt(d) < CELL * 4 ? best : null;
}

function MarkerForm({ draft, places, herald, onChange, onCancel, onSaved }: {
  draft: Draft; places: Place[]; herald: boolean; onChange: (d: Draft) => void; onCancel: () => void; onSaved: (msg: string) => void;
}) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    const row = { ore: draft.ore, x: draft.x, y: draft.y, kind: draft.kind, place: draft.place.trim(), note: draft.note.trim(), veins: Math.min(99, Math.max(1, draft.veins || 1)) };
    const { data, error } = draft.id ? await supabase.from('ore_markers').update(row).eq('id', draft.id).select() : await supabase.from('ore_markers').insert(row).select();
    setBusy(false);
    if (error || !data?.length) return setError(error?.message ?? 'That marker could not be saved.');
    onSaved(draft.id ? 'Marker updated.' : herald ? 'Added to the map.' : 'Sent for approval. An officer will check it in game.');
  };
  return (
    <form className="sheet" onSubmit={save} aria-label={draft.id ? 'Edit marker' : 'New ore vein'}>
      <h2 className="sheet__title">{draft.id ? 'Edit marker' : 'New ore vein'}</h2>
      {!draft.id && <p className="hint" style={{ marginTop: 0 }}>Drag the marker to fine-tune the spot.</p>}
      <span className="label">Ore</span>
      <div className="orepick">
        {ORES.map((o) => (
          <button type="button" key={o.id} className={`orepick__one ${draft.ore === o.id ? 'is-on' : ''}`} aria-pressed={draft.ore === o.id}
            style={{ ['--c' as any]: o.color }} onClick={() => onChange({ ...draft, ore: o.id })}><i />{o.label}</button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <label className="field" style={{ flex: 2, minWidth: 180 }}><span>Where is it</span>
          <select value={draft.kind} onChange={(e) => onChange({ ...draft, kind: e.target.value as OreMarker['kind'] })}>
            {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="field" style={{ width: 96 }}><span>Veins</span>
          <input type="number" min={1} max={99} value={draft.veins} onChange={(e) => onChange({ ...draft, veins: Number(e.target.value) })} />
        </label>
      </div>
      <label className="field"><span>{draft.kind === 'surface' ? 'Nearest place' : 'Name of the place'}</span>
        <input type="text" list="places" value={draft.place} onChange={(e) => onChange({ ...draft, place: e.target.value })} maxLength={80} />
        <datalist id="places">{places.map((p) => <option key={p[0] + p[2]} value={p[0]} />)}</datalist>
      </label>
      <label className="field"><span>Note</span>
        <input type="text" value={draft.note} onChange={(e) => onChange({ ...draft, note: e.target.value })} maxLength={400} placeholder="How to find it, what guards it" />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row row--end">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn--go" disabled={busy}>{draft.id ? 'Save marker' : herald ? 'Add to the map' : 'Send for approval'}</button>
      </div>
    </form>
  );
}

/** Width of the empty strip around the map picture, in its own pixels. */
const EDGE = { left: 200, top: 72, right: 138, bottom: 198 };

export default function MiningMap() {
  useTitle('Mining Map');
  const { profile } = useAuth(); const me = profile!; const herald = isHerald(me.tags);
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null); const geoRef = useRef<Geo | null>(null);
  const layer = useRef<L.LayerGroup>(L.layerGroup()); const placeLayer = useRef<L.LayerGroup>(L.layerGroup());
  const draftMarker = useRef<L.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [markers, setMarkers] = useState<OreMarker[]>([]); const [names, setNames] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Set<string>>(() => new Set(ORES.map((o) => o.id)));
  const [showPlaces, setShowPlaces] = useState(true); const [panel, setPanel] = useState(() => window.innerWidth > 900);
  const [placing, setPlacing] = useState(false); const [draft, setDraft] = useState<Draft | null>(null);
  const [picked, setPicked] = useState<string | null>(null); const [toast, setToast] = useState('');
  const [denying, setDenying] = useState<OreMarker | null>(null); const [denyNote, setDenyNote] = useState('');
  const [removing, setRemoving] = useState<OreMarker | null>(null); const [error, setError] = useState('');

  const toLL = useCallback((x: number, y: number) => {
    const g = geoRef.current!;
    return mapRef.current!.unproject([(x / CELL - g.x0) * g.px_per_cell, (g.y1 - y / CELL) * g.px_per_cell], g.max_zoom);
  }, []);
  const toWorld = useCallback((ll: L.LatLng) => {
    const g = geoRef.current!; const p = mapRef.current!.project(ll, g.max_zoom);
    return { x: Math.round((p.x / g.px_per_cell + g.x0) * CELL), y: Math.round((g.y1 - p.y / g.px_per_cell) * CELL) };
  }, []);

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([supabase.from('ore_markers').select('*').order('created_at', { ascending: false }), supabase.from('profiles').select(PROFILE_COLUMNS)]);
    if (m.error) return setError('Could not load the markers. Check your connection and try again.');
    setError(''); setMarkers(m.data as OreMarker[]);
    setNames(Object.fromEntries(((p.data ?? []) as Profile[]).map((x) => [x.id, x.display_name])));
  }, []);

  // build the map once
  useEffect(() => {
    let dead = false; let sizer: ResizeObserver | null = null;
    (async () => {
      const [geo, pl] = await Promise.all([fetch('./map/map.json').then((r) => r.json()), fetch(dataUrl('places.json')).then((r) => r.json())]);
      if (dead || !el.current) return;
      geoRef.current = geo;
      const map = L.map(el.current, { crs: L.CRS.Simple, minZoom: 0, maxZoom: geo.max_zoom + 2, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
        attributionControl: false, zoomControl: false, maxBoundsViscosity: 1, bounceAtZoomLimits: false, inertia: true });
      mapRef.current = map;
      // The map picture has a flat blue strip around it where the game has no land or sea to draw.
      // The view stops short of that strip, so the strip is never on screen.
      const whole = L.latLngBounds(map.unproject([0, geo.h], geo.max_zoom), map.unproject([geo.w, 0], geo.max_zoom));
      const bounds = L.latLngBounds(map.unproject([EDGE.left, geo.h - EDGE.bottom], geo.max_zoom), map.unproject([geo.w - EDGE.right, EDGE.top], geo.max_zoom));
      L.tileLayer('./map/{z}/{x}_{y}.webp', { tileSize: 256, minZoom: 0, maxNativeZoom: geo.max_zoom, maxZoom: geo.max_zoom + 2, bounds: whole, noWrap: true, keepBuffer: 3 }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.control.attribution({ position: 'bottomleft', prefix: false }).addAttribution('Terrain: Skyrim, Bethesda. Map textures: A Quality World Map by IcePenguin').addTo(map);
      // The edges are locked: the map always covers the screen, so there is never
      // anything to see beyond it. The furthest zoom out is the one where the map
      // just fills the view, and dragging stops dead at the border.
      map.setMaxBounds(bounds);
      const lock = () => {
        const cover = map.getBoundsZoom(bounds, true);
        map.setMinZoom(cover);
        if (map.getZoom() < cover) map.setZoom(cover, { animate: false });
        map.panInsideBounds(bounds, { animate: false });
      };
      // Open filling the view. On a tall phone screen that is a slice of the map, so centre it on home.
      const size = map.getSize(); const home = (pl.places as Place[]).find((p) => p[0] === 'Largashbur');
      const start = size.y > size.x && home
        ? map.unproject([(home[2] / CELL - geo.x0) * geo.px_per_cell, (geo.y1 - home[3] / CELL) * geo.px_per_cell], geo.max_zoom)
        : bounds.getCenter();
      map.setView(start, map.getBoundsZoom(bounds, true), { animate: false });
      lock(); map.on('resize', lock);
      placeLayer.current.addTo(map); layer.current.addTo(map);
      const zoomClass = () => {
        const z = map.getZoom(), c = el.current?.classList;
        c?.toggle('is-tiny', z < 1.5); c?.toggle('is-far', z < 2.75); c?.toggle('is-mid', z < 4.25);
        if (el.current) el.current.dataset.zoom = String(z);
      };
      map.on('zoomend', zoomClass); zoomClass();
      // which part of the map picture is on screen, in its own pixels (the tests read this)
      const noteView = () => {
        const b = map.getBounds(), nw = map.project(b.getNorthWest(), geo.max_zoom), se = map.project(b.getSouthEast(), geo.max_zoom);
        if (el.current) el.current.dataset.view = [nw.x, nw.y, se.x, se.y].map(Math.round).join(',');
      };
      map.on('moveend zoomend resize', noteView); noteView();
      if (typeof ResizeObserver !== 'undefined') { sizer = new ResizeObserver(() => map.invalidateSize({ pan: false })); sizer.observe(el.current); }
      setPlaces(pl.places); setMapReady(true);
    })();
    void load();
    return () => { dead = true; sizer?.disconnect(); mapRef.current?.remove(); mapRef.current = null; };
  }, [load]);

  // place names
  useEffect(() => {
    if (!mapReady) return;
    placeLayer.current.clearLayers();
    if (!showPlaces) return;
    for (const [name, type, x, y, server] of places) {
      const home = name === 'Largashbur';
      const cls = `place ${home ? 'place--home' : type === 'City' ? 'place--city' : MAJOR.has(type) ? 'place--major' : 'place--minor'} ${server ? 'place--server' : ''}`;
      L.marker(toLL(x, y), { interactive: false, keyboard: false, zIndexOffset: home ? 200 : -500,
        icon: L.divIcon({ className: cls, iconSize: [0, 0], html: `<i></i><span>${name.replace(/</g, '&lt;')}</span>` }) }).addTo(placeLayer.current);
    }
  }, [mapReady, places, showPlaces, toLL]);

  // ore markers
  const visible = useMemo(() => markers.filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && (shown.has(m.ore) || !ORE[m.ore] || m.id === picked)), [markers, shown, picked]);
  useEffect(() => {
    if (!mapReady) return;
    layer.current.clearLayers();
    for (const m of visible) {
      if (draft?.id === m.id) continue;
      L.marker(toLL(m.x, m.y), { icon: oreIcon(m, m.id === picked), title: `${ORE[m.ore]?.label ?? m.ore}${m.place ? `, ${m.place}` : ''}`, zIndexOffset: m.id === picked ? 900 : m.status === 'pending' ? 300 : 0 })
        .on('click', () => { if (!draftMarker.current) setPicked(m.id); }).addTo(layer.current);
    }
  }, [mapReady, visible, picked, draft?.id, toLL]);

  // the marker being placed or moved
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return;
    draftMarker.current?.remove(); draftMarker.current = null;
    if (!draft) return;
    const mk = L.marker(toLL(draft.x, draft.y), { draggable: true, icon: oreIcon({ ore: draft.ore, status: 'approved' }, true), zIndexOffset: 1000 }).addTo(map);
    mk.on('dragend', () => { const w = toWorld(mk.getLatLng()); setDraft((d) => (d ? { ...d, ...w } : d)); });
    draftMarker.current = mk;
    return () => { mk.remove(); if (draftMarker.current === mk) draftMarker.current = null; };
  }, [mapReady, draft?.x, draft?.y, draft?.ore, !!draft, toLL, toWorld]);   // eslint-disable-line react-hooks/exhaustive-deps

  // tap the map to place
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady || !placing) return;
    const on = (e: L.LeafletMouseEvent) => {
      const w = toWorld(e.latlng); const near = nearest(places, w.x, w.y);
      setDraft({ ...w, ore: 'iron', kind: near && near[1] === 'Mine' ? 'mine' : 'surface', place: near?.[0] ?? '', note: '', veins: 1 });
      setPlacing(false); setPicked(null);
    };
    map.on('click', on); el.current?.classList.add('is-placing');
    return () => { map.off('click', on); el.current?.classList.remove('is-placing'); };
  }, [mapReady, placing, places, toWorld]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { const t = setTimeout(() => mapRef.current?.invalidateSize(), 60); return () => clearTimeout(t); }, [panel, draft, picked]);

  const current = markers.find((m) => m.id === picked) ?? null;
  const pending = markers.filter((m) => m.status === 'pending');
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const m of markers) if (m.status === 'approved') c[m.ore] = (c[m.ore] ?? 0) + 1; return c; }, [markers]);
  const focus = (m: OreMarker) => { setPicked(m.id); mapRef.current?.flyTo(toLL(m.x, m.y), Math.max(mapRef.current.getZoom(), 4.5), { duration: 0.6 }); if (window.innerWidth <= 900) setPanel(false); };
  const review = async (m: OreMarker, status: 'approved' | 'rejected', note = '') => {
    // Only if the ping is still exactly what this officer was looking at.
    const { data, error } = await supabase.from('ore_markers').update({ status, review_note: note }).eq('id', m.id).eq('updated_at', m.updated_at).select();
    if (error) return setError(error.message);
    if (!data?.length) { setError('That ping was changed after you opened it. Look at it again before deciding.'); setDenying(null); return void load(); }
    setError('');
    setToast(status === 'approved' ? 'Approved. It is on everyone’s map now.' : 'Denied.'); setDenying(null); setDenyNote(''); void load();
  };
  const toggle = (id: string) => setShown((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <Scene quiet />
      <div className="page mapscreen">
        <header className="page__head mapscreen__head"><h1 className="page__title">Mining Map</h1></header>
        <div className="mapwrap">
          <div ref={el} className="map" aria-label="Map of Skyrim with ore veins" />
          {placing && <div className="map__banner" role="status">Tap the map where you found the vein.</div>}
          {toast && <div className="map__banner map__banner--ok" role="status">{toast}</div>}
          {error && <div className="map__banner map__banner--bad" role="alert">{error}</div>}

          {panel && (
            <aside className="mapkey" aria-label="Map key">
              <div className="mapkey__head"><span className="panel__title">Ore veins</span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="btn btn--small btn--ghost" onClick={() => setShown(new Set(ORES.map((o) => o.id)))}>All</button>
                  <button className="btn btn--small btn--ghost" onClick={() => setShown(new Set())}>None</button>
                </span>
              </div>
              <ul className="mapkey__list">
                {ORES.map((o) => (
                  <li key={o.id}><label className={`keyrow ${shown.has(o.id) ? '' : 'is-off'}`}>
                    <input type="checkbox" checked={shown.has(o.id)} onChange={() => toggle(o.id)} />
                    <span className="keyrow__swatch" style={{ ['--c' as any]: o.color, ['--k' as any]: o.ink }}><b>{o.code}</b></span>
                    <span className="keyrow__name">{o.label}</span><span className="keyrow__n">{counts[o.id] ?? 0}</span>
                  </label></li>
                ))}
              </ul>
              <label className="check small" style={{ padding: '2px 12px' }}><input type="checkbox" checked={showPlaces} onChange={(e) => setShowPlaces(e.target.checked)} />Locations</label>
              {(pending.length > 0) && (
                <div className="mapkey__pending">
                  <span className="label">{herald ? `Waiting for approval (${pending.length})` : `Your pings waiting (${pending.length})`}</span>
                  {pending.map((m) => (
                    <button key={m.id} className="pendrow" onClick={() => focus(m)}>
                      <span className="keyrow__swatch" style={{ ['--c' as any]: ORE[m.ore]?.color, ['--k' as any]: ORE[m.ore]?.ink }}><b>{ORE[m.ore]?.code}</b></span>
                      <span>{ORE[m.ore]?.label}{m.place ? `, ${m.place}` : ''}<small>{names[m.created_by ?? ''] ?? 'A member'}, {ago(m.created_at)}</small></span>
                    </button>
                  ))}
                </div>
              )}
            </aside>
          )}

          {draft && <MarkerForm draft={draft} places={places} herald={herald} onChange={setDraft} onCancel={() => setDraft(null)}
            onSaved={(msg) => { setDraft(null); setToast(msg); void load(); }} />}

          {current && !draft && (
            <section className="sheet" aria-label="Marker details">
              <h2 className="sheet__title"><span className="keyrow__swatch" style={{ ['--c' as any]: ORE[current.ore]?.color, ['--k' as any]: ORE[current.ore]?.ink }}><b>{ORE[current.ore]?.code}</b></span>
                {ORE[current.ore]?.label ?? current.ore} {current.veins > 1 ? `×${current.veins}` : ''}</h2>
              {current.status === 'pending' && <p className="note">Waiting for an officer to check it in game.</p>}
              {current.status === 'rejected' && <p className="error">Denied{current.review_note ? `: ${current.review_note}` : '.'}</p>}
              <p>{KIND[current.kind]}{current.place ? `, ${current.kind === 'surface' ? 'near ' : ''}${current.place}` : ''}</p>
              {current.note && <p className="muted">{current.note}</p>}
              <p className="hint">Marked by {names[current.created_by ?? ''] ?? 'a former member'}, {ago(current.created_at)}
                {current.status === 'approved' && current.reviewed_by && current.reviewed_by !== current.created_by ? `. Checked by ${names[current.reviewed_by] ?? 'an officer'}.` : '.'}</p>
              <div className="row" style={{ marginTop: 10 }}>
                {herald && current.status === 'pending' && <>
                  <button className="btn btn--go btn--small" onClick={() => review(current, 'approved')}>Approve</button>
                  <button className="btn btn--danger btn--small" onClick={() => setDenying(current)}>Deny</button>
                </>}
                {(herald || (current.created_by === me.id && current.status === 'pending')) && <button className="btn btn--small"
                  onClick={() => setDraft({ id: current.id, x: current.x, y: current.y, ore: current.ore, kind: current.kind, place: current.place, note: current.note, veins: current.veins })}>Edit</button>}
                {(herald || (current.created_by === me.id && current.status !== 'approved')) && <button className="btn btn--small" onClick={() => setRemoving(current)}>Remove</button>}
                {ORE[current.ore]?.item && <Link className="btn btn--small" to={`/ledger?item=${encodeURIComponent(ORE[current.ore].item!)}`}>In the ledger</Link>}
                <span style={{ flex: 1 }} />
                <button className="btn btn--small" onClick={() => setPicked(null)}>Close</button>
              </div>
            </section>
          )}
        </div>
        <footer className="page__bar mapscreen__bar">
          <Link to="/" className="btn back">Back</Link>
          <button className="btn" aria-pressed={panel} onClick={() => setPanel((p) => !p)}>Key{pending.length ? ` (${pending.length})` : ''}</button>
          <span className="spacer" />
          {placing ? <button className="btn" onClick={() => setPlacing(false)}>Cancel</button>
            : <button className="btn btn--go" disabled={!!draft} onClick={() => { setPicked(null); setPlacing(true); if (window.innerWidth <= 900) setPanel(false); }}>Mark a vein</button>}
        </footer>
      </div>
      {denying && <Confirm title="Deny this ping" action="Deny" danger onClose={() => setDenying(null)} onConfirm={() => review(denying, 'rejected', denyNote.trim())}>
        <label className="field"><span>Reason, shown to the member</span>
          <input type="text" value={denyNote} onChange={(e) => setDenyNote(e.target.value)} maxLength={200} placeholder="Nothing there when we looked" autoFocus /></label>
      </Confirm>}
      {removing && <Confirm title="Remove this marker" action="Remove" danger onClose={() => setRemoving(null)}
        onConfirm={async () => { const { error } = await supabase.from('ore_markers').delete().eq('id', removing.id); if (error) setError(error.message); setRemoving(null); setPicked(null); void load(); }}>
        <p>The {ORE[removing.ore]?.label ?? removing.ore} marker{removing.place ? ` at ${removing.place}` : ''} will be taken off the map.</p>
      </Confirm>}
    </>
  );
}
