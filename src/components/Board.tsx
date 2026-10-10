import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { PROFILE_COLUMNS, type Post, type Profile, type Visibility } from '../lib/types';
import { Confirm, Modal, ago } from './ui';

interface BoardProps {
  table: 'announcements' | 'mine_deals';
  canWrite: boolean;
  withExpiry?: boolean;
  noun: string;                 // "notice", "deal"
  empty: string;
  composing: boolean;
  onComposeDone: () => void;
}

const EXPIRY: [string, number][] = [['Never', 0], ['1 day', 1], ['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['30 days', 30]];
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function left(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s <= 0) return 'Taken down';
  if (s < 3600) return `Comes down in ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `Comes down in ${Math.round(s / 3600)} h`;
  return `Comes down in ${Math.round(s / 86400)} days`;
}

function Editor({ table, post, withExpiry, noun, members, onClose, onSaved }: {
  table: BoardProps['table']; post: Post | null; withExpiry?: boolean; noun: string; members: Profile[]; onClose: () => void; onSaved: () => void;
}) {
  const { profile } = useAuth();
  const mine = !post || post.author_id === profile!.id;
  const [title, setTitle] = useState(post?.title ?? ''); const [body, setBody] = useState(post?.body ?? '');
  const [visibility, setVisibility] = useState<Visibility>(post?.visibility ?? 'all');
  const [audience, setAudience] = useState<string[]>(post?.audience ?? []);
  const [expiry, setExpiry] = useState<string>(post?.expires_at ? 'custom' : '0');
  const [custom, setCustom] = useState(post?.expires_at ? toLocalInput(new Date(post.expires_at)) : toLocalInput(new Date(Date.now() + 7 * 86400000)));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (visibility === 'specific' && audience.length === 0) return setError('Choose at least one member, or pick another option.');
    const row: Record<string, unknown> = { title: title.trim(), body, visibility, audience: visibility === 'specific' ? audience : [] };
    if (withExpiry) row.expires_at = expiry === '0' ? null : expiry === 'custom' ? new Date(custom).toISOString() : new Date(Date.now() + Number(expiry) * 86400000).toISOString();
    setBusy(true);
    const q = post ? supabase.from(table).update(row).eq('id', post.id).select() : supabase.from(table).insert(row).select();
    const { data, error } = await q;
    setBusy(false);
    if (error || !data?.length) return setError(error?.message ?? `That ${noun} could not be saved. It may have been removed.`);
    onSaved(); onClose();
  };
  const toggle = (id: string) => setAudience((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  return (
    <Modal title={post ? `Edit ${noun}` : `New ${noun}`} onClose={onClose} wide>
      <form onSubmit={save}>
        <label className="field"><span>Title</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required autoFocus />
        </label>
        <label className="field"><span>Text</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} rows={7} />
        </label>
        <fieldset className="choice">
          <legend className="label">Who can see it</legend>
          <label className="check"><input type="radio" name="vis" checked={visibility === 'all'} onChange={() => setVisibility('all')} />All members</label>
          <label className="check"><input type="radio" name="vis" checked={visibility === 'specific'} onChange={() => setVisibility('specific')} />Chosen members only</label>
          {visibility === 'specific' && (
            <div className="audience">
              {members.filter((m) => m.id !== profile!.id).map((m) => (
                <label className="check" key={m.id}><input type="checkbox" checked={audience.includes(m.id)} onChange={() => toggle(m.id)} />{m.display_name}</label>
              ))}
            </div>
          )}
          {mine && <label className="check"><input type="radio" name="vis" checked={visibility === 'draft'} onChange={() => setVisibility('draft')} />Private draft, only me</label>}
        </fieldset>
        {withExpiry && (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1, minWidth: 160 }}><span>Take it down after</span>
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                {EXPIRY.map(([l, d]) => <option key={d} value={d}>{l}</option>)}
                <option value="custom">A date and time</option>
              </select>
            </label>
            {expiry === 'custom' && <label className="field" style={{ flex: 1, minWidth: 200 }}><span>Date and time</span>
              <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} required />
            </label>}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row row--end" style={{ marginTop: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--go" disabled={busy}>{post ? 'Save changes' : visibility === 'draft' ? 'Save draft' : `Post ${noun}`}</button>
        </div>
      </form>
    </Modal>
  );
}

/** A board of posts with per-post visibility. Used by the Notice Board and the Mine of the Black Tusks. */
export function Board({ table, canWrite, withExpiry, noun, empty, composing, onComposeDone }: BoardProps) {
  const { profile } = useAuth(); const me = profile!;
  const [posts, setPosts] = useState<Post[] | null>(null); const [members, setMembers] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Post | null>(null); const [removing, setRemoving] = useState<Post | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([supabase.from(table).select('*').order('created_at', { ascending: false }), supabase.from('profiles').select(PROFILE_COLUMNS)]);
    if (p.error) return setError(`Could not load the ${noun}s. Check your connection and try again.`);
    setError(''); setPosts(p.data as Post[]); setMembers((m.data ?? []) as Profile[]);
  }, [table, noun]);
  useEffect(() => { void load(); }, [load]);
  const name = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.display_name])), [members]);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const { error } = await supabase.from(table).delete().eq('id', removing.id);
    setBusy(false);
    if (error) return setError(error.message);
    setRemoving(null); void load();
  };

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {!posts && !error && <p className="empty">Reading the board…</p>}
      {posts && posts.length === 0 && <p className="empty">{empty}</p>}
      <div className="board">
        {posts?.map((p) => {
          const expired = !!p.expires_at && new Date(p.expires_at).getTime() <= Date.now();
          const mine = p.author_id === me.id;
          return (
            <article key={p.id} className={`paper ${expired ? 'is-down' : ''} ${p.visibility === 'draft' ? 'is-draft' : ''}`}>
              <h2 className="paper__title">{p.title}</h2>
              {p.body && <div className="paper__body">{p.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</div>}
              <footer className="paper__foot">
                <span>{p.author_id ? name[p.author_id] ?? 'A former member' : 'A former member'}, {ago(p.created_at)}</span>
                {(canWrite || mine) && p.visibility === 'draft' && <span className="stamp">Private draft</span>}
                {p.visibility === 'specific' && <span className="stamp">
                  {canWrite || mine ? `For ${p.audience.map((id) => name[id] ?? '?').join(', ')}` : 'For you'}</span>}
                {p.updated_by && p.updated_by !== p.author_id && <span>edited by {name[p.updated_by] ?? 'an officer'}</span>}
                {p.expires_at && <span className="stamp">{left(p.expires_at)}</span>}
                {canWrite && (mine || p.visibility !== 'draft') && <span className="paper__acts">
                  <button className="btn btn--small btn--paper" onClick={() => setEditing(p)}>Edit</button>
                  <button className="btn btn--small btn--paper" onClick={() => setRemoving(p)}>Remove</button>
                </span>}
              </footer>
            </article>
          );
        })}
      </div>
      {(composing || editing) && <Editor table={table} post={editing} withExpiry={withExpiry} noun={noun} members={members}
        onClose={() => { setEditing(null); onComposeDone(); }} onSaved={load} />}
      {removing && <Confirm title={`Remove this ${noun}`} action="Remove" danger busy={busy} onClose={() => setRemoving(null)} onConfirm={remove}>
        <p>“{removing.title}” will be taken off the board for everyone.</p>
      </Confirm>}
    </>
  );
}
