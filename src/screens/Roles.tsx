// What each tag in the clan means. The app carries a short description of every tag;
// an officer can put the clan's own words in its place.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { TAGS, isOfficer, type TagInfo } from '../lib/roles';
import type { RoleNote } from '../lib/types';
import { Modal, Page, TagChip } from '../components/ui';

const MAX = 400;

function RoleEditor({ tag, text, custom, onClose, onSaved }: { tag: TagInfo; text: string; custom: boolean; onClose: () => void; onSaved: () => void }) {
  const [about, setAbout] = useState(text); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const store = async (value: string) => {
    setError(''); setBusy(true);
    // Saving the app's own wording, or nothing at all, hands the description back to the app.
    const clean = value.trim();
    const { error } = clean && clean !== tag.about
      ? await supabase.from('role_notes').upsert({ tag: tag.id, about: clean })
      : await supabase.from('role_notes').delete().eq('tag', tag.id);
    setBusy(false);
    if (error) return setError(/row-level security|permission/i.test(error.message) ? 'Only clan officers can change these descriptions.' : error.message);
    onSaved(); onClose();
  };
  return (
    <Modal title={`What ${tag.label} means`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void store(about); }}>
        <p style={{ marginBottom: 12 }}><TagChip id={tag.id} /></p>
        <label className="field"><span>Description</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value.slice(0, MAX))} maxLength={MAX} rows={4} placeholder={tag.about} />
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
  const [editing, setEditing] = useState<TagInfo | null>(null); const [error, setError] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('role_notes').select('tag, about, updated_at');
    if (error) setError('Could not load the clan\'s own descriptions, so the original ones are shown.');
    setNotes(Object.fromEntries(((data ?? []) as RoleNote[]).map((n) => [n.tag, n.about])));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const text = (t: TagInfo) => notes?.[t.id] || t.about;

  return (
    <Page title="Roles" sub="What each tag in the clan means">
      {error && <p className="hint" role="status" style={{ textAlign: 'center', marginBottom: 12 }}>{error}</p>}
      {!notes ? <p className="empty">Reading the roles…</p> : (
        <ul className="roles">
          {TAGS.map((t) => (
            <li key={t.id} className="roles__row">
              <div className="roles__tag"><TagChip id={t.id} /></div>
              <p className="roles__about">{text(t)}</p>
              {officer && <button className="btn btn--small" aria-label={`Edit ${t.label}`} onClick={() => setEditing(t)}>Edit</button>}
            </li>
          ))}
        </ul>
      )}
      <p className="hint" style={{ textAlign: 'center', marginTop: 18 }}>A member can hold more than one tag. Officers hand them out on the Members screen.</p>
      {editing && <RoleEditor tag={editing} text={text(editing)} custom={!!notes?.[editing.id]} onClose={() => setEditing(null)} onSaved={load} />}
    </Page>
  );
}
