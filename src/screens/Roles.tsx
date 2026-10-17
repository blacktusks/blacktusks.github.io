// What each tag in the clan means. The app carries a short description of every tag;
// an officer can put the clan's own words in its place.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { TAGS, isOfficer, type TagInfo } from '../lib/roles';
import type { RoleNote } from '../lib/types';
import { ClanTag, Modal, Page, TagChip } from '../components/ui';
import { CLANS } from '../lib/clan';
import { sfx } from '../lib/sound';

// Clan tags sit apart from the role tags: which clan a member belongs to. A role counts within its own clan.
const CLAN_ABOUT = {
  black_tusks: 'Sworn to the Black Tusks, the clan of Largashbur. Their home screen is the Black Tusks’.',
  scorned: 'Sworn to the Scorned, the clan of Narzulbur. Their home screen is the Scorned’s.',
};

const MAX = 400;

/** One line on the Roles screen. The Right Tusk and Left Tusk share theirs: the same duty, held by two generals,
 *  so one description stands for both (the Left Tusk's tag shown first). */
interface RoleRow { key: string; tags: TagInfo[] }
const PAIRED = ['left_tusk', 'right_tusk'];
const ROWS: RoleRow[] = TAGS.flatMap((t): RoleRow[] => {
  if (t.id === 'left_tusk') return [];
  if (t.id === 'right_tusk') return [{ key: 'tusks', tags: PAIRED.map((id) => TAGS.find((x) => x.id === id)!) }];
  return [{ key: t.id, tags: [t] }];
});
const names = (r: RoleRow) => r.tags.map((t) => t.label).join(' and ');

function RoleEditor({ row, text, custom, onClose, onSaved }: { row: RoleRow; text: string; custom: boolean; onClose: () => void; onSaved: () => void }) {
  const [about, setAbout] = useState(text); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const base = row.tags[row.tags.length - 1];
  const store = async (value: string) => {
    setError(''); setBusy(true);
    // Saving the app's own wording, or nothing at all, hands the description back to the app. A shared row saves
    // the same words for every tag on it.
    const clean = value.trim();
    const ids = row.tags.map((t) => t.id);
    const { error } = clean && clean !== base.about
      ? await supabase.from('role_notes').upsert(ids.map((tag) => ({ tag, about: clean })))
      : await supabase.from('role_notes').delete().in('tag', ids);
    setBusy(false);
    if (error) { sfx('denied'); return setError(/row-level security|permission/i.test(error.message) ? 'Only clan officers can change these descriptions.' : error.message); }
    sfx('save'); onSaved(); onClose();
  };
  return (
    <Modal title={`What ${names(row)} ${row.tags.length > 1 ? 'mean' : 'means'}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void store(about); }}>
        <p className="roles__chips" style={{ marginBottom: 12 }}>{row.tags.map((t) => <TagChip key={t.id} id={t.id} />)}</p>
        <label className="field"><span>Description</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value.slice(0, MAX))} maxLength={MAX} rows={4} placeholder={base.about} />
          <small className={about.length >= MAX - 20 ? 'is-near' : ''}>{about.length} of {MAX} characters. Keep it brief: a line or two on who holds this tag and what they do.</small>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 14 }}>
          {custom && <button type="button" className="btn" disabled={busy} onClick={() => void store('')}>Use the original</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--go" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Roles() {
  const { profile } = useAuth(); const officer = isOfficer(profile!.tags);
  const [notes, setNotes] = useState<Record<string, string> | null>(null);
  const [editing, setEditing] = useState<RoleRow | null>(null); const [error, setError] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('role_notes').select('tag, about, updated_at');
    if (error) setError('Could not load the clan\'s own descriptions, so the original ones are shown.');
    setNotes(Object.fromEntries(((data ?? []) as RoleNote[]).map((n) => [n.tag, n.about])));
  }, []);
  useEffect(() => { void load(); }, [load]);
  // a shared row reads the first of its tags the clan has given words to (the Right Tusk's before the Left Tusk's)
  const own = (r: RoleRow) => [...r.tags].reverse().find((t) => notes?.[t.id]);
  const text = (r: RoleRow) => { const t = own(r); return t ? notes![t.id] : r.tags[r.tags.length - 1].about; };

  return (
    <Page title="Roles" sub="What each tag in the clan means">
      {error && <p className="hint" role="status" style={{ textAlign: 'center', marginBottom: 12 }}>{error}</p>}
      {!notes ? <p className="empty">Reading the roles…</p> : (
        <ul className="roles">
          {ROWS.map((r) => (
            <li key={r.key} className="roles__row">
              <div className="roles__tag roles__chips">{r.tags.map((t) => <TagChip key={t.id} id={t.id} />)}</div>
              <p className="roles__about">{text(r)}</p>
              {officer && <button className="btn btn--small" aria-label={`Edit ${names(r)}`} onClick={() => setEditing(r)}>Edit</button>}
            </li>
          ))}
        </ul>
      )}
      <p className="hint" style={{ textAlign: 'center', marginTop: 18 }}>A member can hold more than one tag. Officers hand them out on the Members screen.</p>
      <h2 className="roles__h">Clan tags</h2>
      <ul className="roles">
        {CLANS.map((c) => (
          <li key={c} className="roles__row">
            <div className="roles__tag"><ClanTag id={c} /></div>
            <p className="roles__about">{CLAN_ABOUT[c]}</p>
          </li>
        ))}
      </ul>
      <p className="hint" style={{ textAlign: 'center', marginTop: 18 }}>Every member carries at least one clan tag. A role counts within its own clan: the Scorned Chieftain leads the Scorned. Only the Forgemaster changes clan tags.</p>
      {editing && <RoleEditor row={editing} text={text(editing)} custom={!!own(editing)} onClose={() => setEditing(null)} onSaved={load} />}
    </Page>
  );
}
