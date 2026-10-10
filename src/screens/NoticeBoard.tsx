import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { isForgemaster, isHerald } from '../lib/roles';
import type { ChangelogEntry } from '../lib/types';
import { Board } from '../components/Board';
import { Confirm, Modal, Page } from '../components/ui';

function EntryEditor({ entry, onClose, onSaved }: { entry: ChangelogEntry | null; onClose: () => void; onSaved: () => void }) {
  const [version, setVersion] = useState(entry?.version ?? ''); const [title, setTitle] = useState(entry?.title ?? '');
  const [body, setBody] = useState(entry?.body ?? ''); const [date, setDate] = useState(entry?.released_at ?? new Date().toISOString().slice(0, 10));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const row = { version: version.trim(), title: title.trim(), body, released_at: date };
    const { error } = entry ? await supabase.from('changelog').update(row).eq('id', entry.id) : await supabase.from('changelog').insert(row);
    setBusy(false);
    if (error) return setError(error.message);
    onSaved(); onClose();
  };
  return (
    <Modal title={entry ? 'Edit entry' : 'New change log entry'} onClose={onClose}>
      <form onSubmit={save}>
        <div className="row">
          <label className="field" style={{ width: 130 }}><span>Version</span><input type="text" value={version} onChange={(e) => setVersion(e.target.value)} maxLength={24} placeholder="0.2.0" /></label>
          <label className="field" style={{ flex: 1, minWidth: 160 }}><span>Date</span><input type="text" value={date} onChange={(e) => setDate(e.target.value)} pattern="\d{4}-\d{2}-\d{2}" placeholder="2026-10-10" required /></label>
        </div>
        <label className="field"><span>What changed</span><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></label>
        <label className="field"><span>Details</span><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={8000} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row row--end"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn--go" disabled={busy}>Save entry</button></div>
      </form>
    </Modal>
  );
}

function Changelog({ canEdit, adding, onAddDone }: { canEdit: boolean; adding: boolean; onAddDone: () => void }) {
  const [rows, setRows] = useState<ChangelogEntry[] | null>(null);
  const [editing, setEditing] = useState<ChangelogEntry | null>(null); const [removing, setRemoving] = useState<ChangelogEntry | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('changelog').select('*').order('released_at', { ascending: false }).order('created_at', { ascending: false });
    setRows((data ?? []) as ChangelogEntry[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      {!rows && <p className="empty">Reading the log…</p>}
      {rows?.length === 0 && <p className="empty">Nothing has been logged yet.</p>}
      <ol className="log">
        {rows?.map((r) => (
          <li key={r.id} className="log__row">
            <div className="log__when">{r.version && <strong>{r.version}</strong>}<span>{new Date(r.released_at + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span></div>
            <div>
              <h2 className="log__title">{r.title}</h2>
              {r.body.split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i} className="log__body">{p}</p>)}
              {canEdit && <div className="row" style={{ marginTop: 8 }}>
                <button className="btn btn--small" onClick={() => setEditing(r)}>Edit</button>
                <button className="btn btn--small" onClick={() => setRemoving(r)}>Remove</button>
              </div>}
            </div>
          </li>
        ))}
      </ol>
      {(adding || editing) && <EntryEditor entry={editing} onClose={() => { setEditing(null); onAddDone(); }} onSaved={load} />}
      {removing && <Confirm title="Remove this entry" action="Remove" danger onClose={() => setRemoving(null)}
        onConfirm={async () => { await supabase.from('changelog').delete().eq('id', removing.id); setRemoving(null); void load(); }}>
        <p>“{removing.title}” will be removed from the change log.</p>
      </Confirm>}
    </>
  );
}

export default function NoticeBoard() {
  const { profile } = useAuth(); const tags = profile!.tags;
  const [tab, setTab] = useState<'notices' | 'log'>('notices');
  const [composing, setComposing] = useState(false);
  const canPost = tab === 'notices' ? isHerald(tags) : isForgemaster(tags);
  return (
    <Page title="Notice Board" width="wide"
      bar={canPost && <button className="btn btn--go" onClick={() => setComposing(true)}>{tab === 'notices' ? 'Post a notice' : 'Add an entry'}</button>}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'notices'} className={`tabs__one ${tab === 'notices' ? 'is-on' : ''}`} onClick={() => { setTab('notices'); setComposing(false); }}>Announcements</button>
        <button role="tab" aria-selected={tab === 'log'} className={`tabs__one ${tab === 'log' ? 'is-on' : ''}`} onClick={() => { setTab('log'); setComposing(false); }}>Change log</button>
      </div>
      {tab === 'notices'
        ? <Board table="announcements" canWrite={isHerald(tags)} withExpiry noun="notice" composing={composing} onComposeDone={() => setComposing(false)}
            empty={isHerald(tags) ? 'The board is bare. Post the first notice.' : 'The board is bare. Nothing has been posted for you yet.'} />
        : <Changelog canEdit={isForgemaster(tags)} adding={composing} onAddDone={() => setComposing(false)} />}
    </Page>
  );
}
