import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api, supabase } from '../lib/supabase';
import { TAGS, isForgemaster, isOfficer, sortTags, standing } from '../lib/roles';
import { PROFILE_COLUMNS, type Profile } from '../lib/types';
import { Confirm, Modal, Page, Tags } from '../components/ui';
import { Masteries, MasteryTag } from '../components/Mastery';
import { AvailabilityEditor, AvailabilityStrip } from '../components/Availability';
import { MAX_LEVEL, MAX_MASTERIES, SKILL, SKILLS, cleanMasteries, type Mastery } from '../lib/masteries';
import { cleanWeek, deviceZone, hoursFree } from '../lib/availability';
import { ChangePassword } from './Account';

interface Presence { configured: boolean; ok?: boolean; reason?: string; server?: string; members: { name: string; status: string; game: string | null }[] }
type Status = 'realm' | 'discord' | 'offline' | 'unlinked' | 'unknown';
const STATUS: Record<Status, [string, string]> = {
  realm: ['In the realm', 'Discord shows them playing Skyrim right now.'],
  discord: ['In Discord', 'Online in Discord, not in the game.'],
  offline: ['Offline', 'Not online in Discord.'],
  unlinked: ['Not linked', 'No Discord name on their profile yet.'],
  unknown: ['', ''],
};
const norm = (s: string) => s.trim().toLowerCase().replace(/#\d{1,4}$/, '');

function statusOf(p: Profile, presence: Presence | null): { status: Status; game?: string } {
  if (!presence?.configured || presence.ok === false) return { status: 'unknown' };
  if (!p.discord_name) return { status: 'unlinked' };
  const hit = presence.members.find((m) => norm(m.name) === norm(p.discord_name!));
  if (!hit) return { status: 'offline' };
  if (hit.game && /skyrim|daedric online/i.test(hit.game)) return { status: 'realm', game: hit.game };
  return { status: 'discord', game: hit.game ?? undefined };
}

function TagPicker({ value, onChange, mine }: { value: string[]; onChange: (t: string[]) => void; mine: string[] }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((t) => t !== id) : [...value, id]);
  const locked = (id: string) => (id === 'forgemaster' && !mine.includes('forgemaster'))
    || (id === 'chieftain' && !mine.includes('chieftain') && !mine.includes('forgemaster'));
  return (
    <div className="tagpick">
      {TAGS.map((t) => (
        <button type="button" key={t.id} className={`tagpick__one ${value.includes(t.id) ? 'is-on' : ''}`} style={{ ['--c' as any]: t.color }}
          aria-pressed={value.includes(t.id)} disabled={locked(t.id)} title={locked(t.id) ? 'Only the Chieftain or a Forgemaster can change this tag.' : t.about}
          onClick={() => toggle(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

/** The card as everyone sees it: masteries, bio and usual hours. */
function About({ member, own }: { member: Profile; own: boolean }) {
  const masteries = cleanMasteries(member.masteries), week = cleanWeek(member.availability);
  if (!masteries.length && !member.bio && !hoursFree(week)) {
    return <p className="muted about__empty">{own ? 'Nothing on your card yet. Press Edit to add a bio, your masteries and the hours you are usually around.' : 'Nothing on their card yet.'}</p>;
  }
  return (
    <div className="about">
      {masteries.length > 0 && <section><span className="label">Masteries</span><Masteries list={masteries} /></section>}
      {member.bio && <section><span className="label">Bio</span><p className="about__bio">{member.bio}</p></section>}
      {hoursFree(week) > 0 && <section><span className="label">Usually around</span><AvailabilityStrip week={week} zone={member.timezone ?? null} own={own} /></section>}
    </div>
  );
}

/** Choose up to three masteries and a level for each. The tag beside each row is how it will look. */
function MasteryPicker({ value, onChange }: { value: Mastery[]; onChange: (m: Mastery[]) => void }) {
  const taken = value.map((m) => m.skill);
  const set = (i: number, patch: Partial<Mastery>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const add = () => { const next = SKILLS.find((sk) => !taken.includes(sk.id)); if (next) onChange([...value, { skill: next.id, level: 0 }]); };
  return (
    <div className="masterypick">
      {value.map((m, i) => (
        <div className="masterypick__row" key={i}>
          <select className="input" aria-label={`Mastery ${i + 1}`} value={m.skill} onChange={(e) => set(i, { skill: e.target.value })}>
            {SKILLS.filter((sk) => sk.id === m.skill || !taken.includes(sk.id)).map((sk) => <option key={sk.id} value={sk.id}>{sk.label}</option>)}
          </select>
          <div className="levelpick" role="group" aria-label={`${SKILL[m.skill]?.label} level`}>
            {Array.from({ length: MAX_LEVEL + 1 }, (_, l) => (
              <button type="button" key={l} className={m.level === l ? 'is-on' : ''} aria-pressed={m.level === l} aria-label={`Level ${l}`} onClick={() => set(i, { level: l })}>{l}</button>
            ))}
          </div>
          <button type="button" className="btn btn--small btn--ghost" aria-label={`Remove ${SKILL[m.skill]?.label}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          <span className="masterypick__preview"><MasteryTag mastery={m} /></span>
        </div>
      ))}
      {value.length < MAX_MASTERIES
        ? <button type="button" className="btn btn--small" onClick={add}>Add a mastery</button>
        : <p className="hint">Three is the limit. Remove one to choose another.</p>}
    </div>
  );
}

function Secret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret">
      <span className="label">{label}</span>
      <div className="row"><code className="secret__value">{value}</code>
        <button type="button" className="btn btn--small" onClick={() => { navigator.clipboard?.writeText(value).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

function AddMember({ mine, onClose, onAdded }: { mine: string[]; onClose: () => void; onAdded: () => void }) {
  const [username, setUsername] = useState(''); const [display, setDisplay] = useState(''); const [discord, setDiscord] = useState('');
  const [tags, setTags] = useState<string[]>(['unblooded']);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ profile: Profile; password: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      setMade(await api('admin.create', { username, display_name: display, discord_name: discord, tags }));
      onAdded();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  if (made) {
    return (
      <Modal title="Account ready" onClose={onClose} foot={<button className="btn btn--go" onClick={onClose}>Done</button>}>
        <p style={{ marginBottom: 14 }}>Send {made.profile.display_name} these two things. They will be asked to choose their own password the first time they sign in.</p>
        <Secret label="Name" value={made.profile.username ?? ''} />
        <Secret label="Temporary password" value={made.password} />
      </Modal>
    );
  }
  return (
    <Modal title="Add a member" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span>Sign-in name</span>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} required minLength={3} maxLength={24} />
          <small>What they type to sign in. Letters, numbers, dot, dash or underscore. Capitals are kept as you type them, and never matter when signing in.</small>
        </label>
        <label className="field"><span>Display name</span>
          <input type="text" value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={40} placeholder="Their character's name" />
        </label>
        <label className="field"><span>Discord name</span>
          <input type="text" value={discord} onChange={(e) => setDiscord(e.target.value)} maxLength={64} placeholder="Optional" />
          <small>As it shows in the clan Discord's member list. Used for online status.</small>
        </label>
        <span className="label">Tags</span>
        <TagPicker value={tags} onChange={setTags} mine={mine} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row row--end" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--go" disabled={busy}>{busy ? 'Adding…' : 'Add member'}</button>
        </div>
      </form>
    </Modal>
  );
}

function MemberCard({ member, me, presence, onClose, onChanged }: {
  member: Profile; me: Profile; presence: Presence | null; onClose: () => void; onChanged: () => void;
}) {
  const { reload } = useAuth();
  const self = member.id === me.id;
  const officer = isOfficer(me.tags), smith = isForgemaster(me.tags);
  const canManage = officer && (smith || !member.tags.includes('forgemaster') || self);
  const editable = self || canManage;
  // Every card opens as members see it. Edit switches to the form.
  const [editing, setEditing] = useState(false);
  const [display, setDisplay] = useState(member.display_name); const [discord, setDiscord] = useState(member.discord_name ?? '');
  const [username, setUsername] = useState(member.username ?? ''); const [tags, setTags] = useState(member.tags);
  const [bio, setBio] = useState(member.bio ?? ''); const [masteries, setMasteries] = useState<Mastery[]>(() => cleanMasteries(member.masteries));
  const [zone, setZone] = useState(member.timezone ?? deviceZone()); const [week, setWeek] = useState(() => cleanWeek(member.availability));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const [changing, setChanging] = useState(false); const [removing, setRemoving] = useState(false);
  const [revealed, setRevealed] = useState<string | null | undefined>(undefined);
  const [newPass, setNewPass] = useState(''); const [setTo, setSetTo] = useState('');
  const st = statusOf(member, presence);

  const run = async (fn: () => Promise<void>) => {
    setError(''); setBusy(true); setSaved(false);
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const startEditing = () => {
    // start from what is saved now, not from an edit that was abandoned earlier
    setDisplay(member.display_name); setDiscord(member.discord_name ?? ''); setUsername(member.username ?? ''); setTags(member.tags);
    setBio(member.bio ?? ''); setMasteries(cleanMasteries(member.masteries)); setZone(member.timezone ?? deviceZone()); setWeek(cleanWeek(member.availability));
    setError(''); setSaved(false); setEditing(true);
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      // An officer sets another member's masteries with the rest of their profile; your own card saves itself below.
      if (canManage) await api('admin.update', { id: member.id, display_name: display, discord_name: discord, tags, ...(smith ? { username } : {}), ...(self ? {} : { masteries }) });
      else { const { error } = await supabase.rpc('update_my_profile', { p_display_name: display, p_discord_name: discord }); if (error) throw new Error(error.message); }
      if (self) {
        const { error } = await supabase.rpc('update_my_card', { p_bio: bio, p_masteries: masteries, p_timezone: zone || null, p_availability: hoursFree(week) ? week : null });
        if (error) throw new Error(/check constraint/.test(error.message) ? 'Your card was not saved: something in it is not allowed. Keep the bio to 500 characters.' : error.message);
        await reload();
      }
      onChanged(); setSaved(true); setEditing(false);
    });
  };

  if (changing) return <ChangePassword onClose={() => setChanging(false)} onDone={() => { setChanging(false); onClose(); }} />;
  if (removing) {
    return (
      <Confirm title="Remove this member" action="Remove" danger busy={busy} onClose={() => setRemoving(false)}
        onConfirm={() => run(async () => { await api('admin.delete', { id: member.id }); onChanged(); onClose(); })}>
        <p>{member.display_name} will no longer be able to sign in. This cannot be undone.</p>
        <p className="hint">If their character has died, give them the Deceased tag instead so they keep their place by the fire.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </Confirm>
    );
  }
  const top = (
    <div className="member__top">
      <Tags tags={member.tags} />
      {st.status !== 'unknown' && <span className={`presence presence--${st.status}`} title={STATUS[st.status][1]}>{STATUS[st.status][0]}{st.game && st.status === 'discord' ? ` (${st.game})` : ''}</span>}
    </div>
  );
  if (!editing) {
    return (
      <Modal title={member.display_name} onClose={onClose}>
        {top}
        <About member={member} own={self} />
        {member.discord_name && <p className="muted" style={{ marginTop: 12 }}>Discord: {member.discord_name}</p>}
        {saved && <p className="note" role="status">Saved.</p>}
        <div className="row row--end" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Close</button>
          {editable && <button className="btn btn--go" onClick={startEditing}>Edit</button>}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Editing ${member.display_name}`} onClose={onClose} wide>
      {top}
      <form onSubmit={save} style={{ marginTop: 16 }}>
        <label className="field"><span>Display name</span>
          <input type="text" value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={40} required />
        </label>
        <label className="field"><span>Discord name</span>
          <input type="text" value={discord} onChange={(e) => setDiscord(e.target.value)} maxLength={64} />
          <small>As it shows in the clan Discord's member list. This is how the Members screen knows who is online.</small>
        </label>
        {self && (
          <label className="field"><span>Bio</span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 500))} maxLength={500} rows={4} placeholder="Who is your character? What do you do for the clan?" />
            <small className={bio.length >= 480 ? 'is-near' : ''}>{bio.length} of 500 characters</small>
          </label>
        )}
        {(self || canManage) && <>
          <span className="label">Masteries</span>
          <MasteryPicker value={masteries} onChange={setMasteries} />
          {!self && <p className="hint">As an officer you can set {member.display_name}'s masteries. Their bio and hours are theirs to write.</p>}
        </>}
        {self && <AvailabilityEditor week={week} zone={zone} onWeek={setWeek} onZone={setZone} />}
        {canManage && <>
          <label className="field"><span>Sign-in name</span>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!smith} autoCapitalize="none" spellCheck={false} />
            {!smith && <small>Only a Forgemaster can change a sign-in name.</small>}
          </label>
          <span className="label">Tags</span>
          <TagPicker value={tags} onChange={setTags} mine={me.tags} />
        </>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 16 }}>
          {self && <button type="button" className="btn" onClick={() => setChanging(true)}>Change password</button>}
          {canManage && !self && <button type="button" className="btn btn--danger" onClick={() => setRemoving(true)}>Remove member</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={() => { setError(''); setEditing(false); }}>Cancel</button>
          <button className="btn btn--go" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
      {smith && (
        <section className="vault">
          <span className="label">Password (Forgemaster only)</span>
          {revealed === undefined
            ? <button type="button" className="btn btn--small" disabled={busy} onClick={() => run(async () => { setRevealed((await api<{ password: string | null }>('admin.reveal_password', { id: member.id })).password); })}>Show current password</button>
            : revealed === null ? <p className="muted">No copy on file. Set a new password below.</p> : <Secret label="Current password" value={revealed} />}
          <div className="row" style={{ marginTop: 12 }}>
            <input className="input" style={{ flex: 1, minWidth: 180 }} type="text" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="New password, or leave blank to generate one" aria-label="New password" autoComplete="off" />
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => run(async () => { const r = await api<{ password: string }>('admin.set_password', { id: member.id, password: newPass || undefined }); setSetTo(r.password); setRevealed(r.password); setNewPass(''); })}>Set password</button>
          </div>
          {setTo && <p className="note" role="status">Password set. {member.display_name} will be asked to choose their own at next sign-in.</p>}
          <p className="hint">Every view is written to the audit log.</p>
        </section>
      )}
    </Modal>
  );
}

function DiscordSetup({ presence, onClose, onSaved }: { presence: Presence | null; onClose: () => void; onSaved: () => void }) {
  const [id, setId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  useEffect(() => { supabase.from('app_settings').select('value').eq('key', 'discord_guild_id').maybeSingle().then(({ data }) => setId(String(data?.value ?? ''))); }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    const clean = id.replace(/\D/g, '');
    const { error } = clean
      ? await supabase.from('app_settings').upsert({ key: 'discord_guild_id', value: clean })
      : await supabase.from('app_settings').delete().eq('key', 'discord_guild_id');
    setBusy(false);
    if (error) return setError(error.message);
    setDone(true); onSaved();
  };
  return (
    <Modal title="Discord link" onClose={onClose}>
      <form onSubmit={save}>
        <ol className="steps">
          <li>In the clan Discord, open <strong>Server Settings</strong>, then <strong>Widget</strong>, and turn on <strong>Enable Server Widget</strong>.</li>
          <li>Copy the <strong>Server ID</strong> shown on that same page and paste it here.</li>
          <li>Put each member's Discord name on their profile. Members can do this themselves.</li>
        </ol>
        <label className="field"><span>Server ID</span>
          <input type="text" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} placeholder="18 or 19 digits" />
        </label>
        <p className="hint">A member shows as in the realm when Discord reports them playing Skyrim. Discord cannot tell Daedric Online from single-player Skyrim, and members who hide their game activity show as in Discord only.</p>
        {presence?.configured && presence.ok === false && <p className="error">{presence.reason}</p>}
        {presence?.ok && <p className="note">Connected to {presence.server}. {presence.members.length} online right now.</p>}
        {presence?.ok && presence.members.length > 0 && (
          <p className="hint">Names as Discord reports them right now: {presence.members.map((m) => m.name).join(', ')}.
            The Discord name on a member's profile has to match one of these (capitals do not matter).
            {presence.members.some((m) => m.game) ? '' : ' Nobody is showing a game at the moment, so nobody will read as in the realm.'}</p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {done && <p className="note" role="status">Saved.</p>}
        <div className="row row--end" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button className="btn btn--go" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Members() {
  const { profile } = useAuth(); const me = profile!; const officer = isOfficer(me.tags);
  const [members, setMembers] = useState<Profile[] | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [open, setOpen] = useState<string | null>(null); const [adding, setAdding] = useState(false); const [discord, setDiscord] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    // Officers get the full rows (sign-in names included); everyone else the public columns.
    const { data, error } = officer ? await supabase.rpc('member_admin_list') : await supabase.from('profiles').select(PROFILE_COLUMNS);
    if (error) setError('Could not load the members. Check your connection and try again.'); else { setError(''); setMembers(data as Profile[]); }
  }, [officer]);
  const loadPresence = useCallback(() => { api<Presence>('discord.presence').then(setPresence).catch(() => setPresence(null)); }, []);
  useEffect(() => { void load(); loadPresence(); const t = setInterval(loadPresence, 60000); return () => clearInterval(t); }, [load, loadPresence]);

  const sorted = useMemo(() => [...(members ?? [])].sort((a, b) => standing(a.tags) - standing(b.tags) || a.display_name.localeCompare(b.display_name)), [members]);
  const inRealm = sorted.filter((m) => statusOf(m, presence).status === 'realm').length;
  const current = sorted.find((m) => m.id === open);
  const live = presence?.configured && presence.ok !== false;

  return (
    <Page title="Members" sub={members ? `${members.length} by the fire${live ? `, ${inRealm} in the realm now` : ''}` : undefined}
      bar={<>
        {isForgemaster(me.tags) && <button className="btn" onClick={() => setDiscord(true)}>Discord link</button>}
        {isOfficer(me.tags) && <button className="btn btn--go" onClick={() => setAdding(true)}>Add member</button>}
      </>}>
      {error && <p className="error" role="alert">{error}</p>}
      {!members && !error && <p className="empty">Counting heads…</p>}
      {members && (
        <ul className="roster">
          {sorted.map((m) => {
            const st = statusOf(m, presence);
            return (
              <li key={m.id}>
                <button className={`roster__row ${m.tags.includes('deceased') ? 'is-fallen' : ''}`} onClick={() => setOpen(m.id)}>
                  <span className={`dot dot--${st.status}`} aria-hidden="true" />
                  <span className="roster__name">{m.display_name}{m.id === me.id && <em> (you)</em>}</span>
                  <span className="roster__tags"><span className="tags">{sortTags(m.tags).map((t) => <span key={t} className="tag" style={{ ['--c' as any]: TAGS.find((x) => x.id === t)?.color }}>{TAGS.find((x) => x.id === t)?.label}</span>)}</span>
                    <Masteries list={cleanMasteries(m.masteries)} mini /></span>
                  {st.status !== 'unknown' && <span className={`presence presence--${st.status}`}>{STATUS[st.status][0]}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {members && !live && <p className="hint" style={{ textAlign: 'center', marginTop: 18 }}>
        {presence?.configured ? presence.reason : isForgemaster(me.tags) ? 'Online status is off until the clan Discord is linked. Use Discord link below.' : 'Online status appears here once the Forgemaster links the clan Discord.'}
      </p>}
      {current && <MemberCard key={current.id} member={current} me={me} presence={presence} onClose={() => setOpen(null)} onChanged={load} />}
      {adding && <AddMember mine={me.tags} onClose={() => setAdding(false)} onAdded={load} />}
      {discord && <DiscordSetup presence={presence} onClose={() => setDiscord(false)} onSaved={loadPresence} />}
    </Page>
  );
}
