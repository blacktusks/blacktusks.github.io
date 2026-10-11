// A member's card: the pop-up behind a name on the Members and Deceased screens,
// and behind Profile on the main menu. It opens as everyone sees it; Edit turns it into a form.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api, supabase } from '../lib/supabase';
import { TAGS, isFallen, isForgemaster, isOfficer } from '../lib/roles';
import type { Profile } from '../lib/types';
import { Confirm, Modal, Tags } from './ui';
import { Masteries, MasteryTag } from './Mastery';
import { AvailabilityEditor, AvailabilityStrip } from './Availability';
import { MAX_LEVEL, MAX_MASTERIES, SKILL, SKILLS, cleanMasteries, type Mastery } from '../lib/masteries';
import { cleanWeek, deviceZone, hoursFree } from '../lib/availability';
import { ChangePassword } from '../screens/Account';

export interface Presence { configured: boolean; ok?: boolean; reason?: string; server?: string; members: { name: string; status: string; game: string | null }[] }
export type Status = 'realm' | 'discord' | 'offline' | 'unknown';
export const STATUS: Record<Status, [string, string]> = {
  realm: ['In the realm', 'Discord shows them playing Skyrim right now.'],
  discord: ['In Discord', 'Online in Discord, not in the realm.'],
  offline: ['Offline', 'Not online in Discord.'],
  unknown: ['', ''],
};
export const norm = (s: string) => s.trim().toLowerCase().replace(/#\d{1,4}$/, '');

/** The name looked for in Discord's list: the Discord name on the profile, or the member's own name when that is blank.
 *  Discord's widget reports each member by their nickname in the clan server (their own Discord name if they have no nickname). */
export const discordKey = (p: Profile) => norm(p.discord_name || p.display_name);

export function statusOf(p: Profile, presence: Presence | null): { status: Status; game?: string } {
  if (!presence?.configured || presence.ok === false) return { status: 'unknown' };
  const hit = presence.members.find((m) => norm(m.name) === discordKey(p));
  if (!hit) return { status: 'offline' };
  if (hit.game && /skyrim|daedric online/i.test(hit.game)) return { status: 'realm', game: hit.game };
  return { status: 'discord' };          // whatever else they are playing is their own business
}
export const ON_APP = 'Has the companion app open right now.';

/** A day as it is written on a card. Kept at noon so no time zone can push it onto the day before. */
export const longDate = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

export function TagPicker({ value, onChange, mine }: { value: string[]; onChange: (t: string[]) => void; mine: string[] }) {
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

/** The card of a fallen character: a passage in their honor, how they died and when, in place of a bio and hours. */
function Fallen({ member }: { member: Profile }) {
  const masteries = cleanMasteries(member.masteries);
  return (
    <div className="about">
      {masteries.length > 0 && <section><span className="label">Masteries</span><Masteries list={masteries} /></section>}
      <section><span className="label">Passage of honor</span>
        {member.death_honor ? <p className="about__bio fallen__honor">{member.death_honor}</p> : <p className="muted">Not yet written.</p>}
      </section>
      <section><span className="label">Cause of death</span>
        {member.death_cause ? <p className="about__bio">{member.death_cause}</p> : <p className="muted">Not yet recorded.</p>}
      </section>
      <section><span className="label">Date of passing</span>
        {/* empty until an officer enters it */}
        <p className={`fallen__date ${member.death_date || member.death_date_unknown ? '' : 'is-blank'}`}>
          {member.death_date_unknown ? 'UNKNOWN' : member.death_date ? longDate(member.death_date) : '\u00a0'}
        </p>
      </section>
    </div>
  );
}

/** Pay Respect: a green pair of praying hands and a fire rise from the button and are gone in a moment.
 *  Nothing is saved; it is a gesture, and it can be made as often as it is meant. */
function PayRespect({ name }: { name: string }) {
  const [bursts, setBursts] = useState<number[]>([]);
  const next = useRef(0); const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  const pay = () => {
    const id = ++next.current;
    setBursts((b) => [...b.slice(-5), id]);
    // gone as soon as it has faded, whether or not the browser was drawing at the time
    timers.current.push(window.setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 1350));
  };
  return (
    <span className="respect">
      <button type="button" className="btn" onClick={pay}>Pay Respect</button>
      {bursts.map((id) => (
        <span key={id} className="respect__burst" aria-hidden="true"><span className="respect__pray">🙏</span><span className="respect__fire">🔥</span></span>
      ))}
      <span className="sr" role="status">{bursts.length ? `You pay your respects to ${name}.` : ''}</span>
    </span>
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

export function Secret({ label, value }: { label: string; value: string }) {
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

export function MemberCard({ member, me, presence, onApp, onClose, onChanged, onMoved }: {
  member: Profile; me: Profile; presence: Presence | null; onApp: boolean; onClose: () => void; onChanged: () => void;
  /** Called instead of showing "Saved" when the save put the member on the other list (Members or Deceased). */
  onMoved?: (name: string, fallen: boolean) => void;
}) {
  const { reload } = useAuth();
  const self = member.id === me.id;
  const fallen = isFallen(member.tags);
  const officer = isOfficer(me.tags), smith = isForgemaster(me.tags);
  const canManage = officer && (smith || !member.tags.includes('forgemaster') || self);
  const editable = self || canManage;
  // Every card opens as members see it. Edit switches to the form.
  const [editing, setEditing] = useState(false);
  const [display, setDisplay] = useState(member.display_name); const [discord, setDiscord] = useState(member.discord_name ?? '');
  const [username, setUsername] = useState(member.username ?? ''); const [tags, setTags] = useState(member.tags);
  const [bio, setBio] = useState(member.bio ?? ''); const [masteries, setMasteries] = useState<Mastery[]>(() => cleanMasteries(member.masteries));
  const [zone, setZone] = useState(member.timezone ?? deviceZone()); const [week, setWeek] = useState(() => cleanWeek(member.availability));
  const [honor, setHonor] = useState(member.death_honor ?? '');
  const [cause, setCause] = useState(member.death_cause ?? ''); const [died, setDied] = useState(member.death_date ?? '');
  const [dateUnknown, setDateUnknown] = useState(!!member.death_date_unknown);
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
    setHonor(member.death_honor ?? ''); setCause(member.death_cause ?? ''); setDied(member.death_date ?? ''); setDateUnknown(!!member.death_date_unknown);
    setError(''); setSaved(false); setEditing(true);
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (canManage) await api('admin.update', { id: member.id, display_name: display, discord_name: discord, tags, ...(smith ? { username } : {}) });
      else { const { error } = await supabase.rpc('update_my_profile', { p_display_name: display, p_discord_name: discord }); if (error) throw new Error(error.message); }
      // An officer sets another member's masteries; your own card saves itself below. The database checks the list either way.
      if (canManage && !self) { const { error } = await supabase.rpc('set_member_masteries', { p_id: member.id, p_masteries: masteries }); if (error) throw new Error(error.message); }
      // The passage of honor, how a character died and when are the officers' to write. They stay with the Deceased tag.
      if (canManage && fallen && tags.includes('deceased')) {
        const { error } = await supabase.rpc('set_death_record', { p_id: member.id, p_honor: honor, p_cause: cause, p_date: dateUnknown || !died ? null : died, p_unknown: dateUnknown });
        if (error) throw new Error(/not possible/.test(error.message) ? 'That date of passing is not possible. It cannot be in the future.' : error.message);
      }
      if (self) {
        // A fallen character has no bio or hours to edit; what was there before is left as it was.
        const { error } = fallen
          ? await supabase.rpc('update_my_card', { p_bio: member.bio ?? '', p_masteries: masteries, p_timezone: member.timezone ?? null, p_availability: member.availability ?? null })
          : await supabase.rpc('update_my_card', { p_bio: bio, p_masteries: masteries, p_timezone: zone || null, p_availability: hoursFree(week) ? week : null });
        if (error) throw new Error(/check constraint/.test(error.message) ? 'Your card was not saved: something in it is not allowed. Keep the bio to 500 characters.' : error.message);
        await reload();
      }
      onChanged();
      const nowFallen = canManage ? tags.includes('deceased') : fallen;
      if (nowFallen !== fallen && onMoved) { onMoved(display.trim() || member.display_name, nowFallen); return; }
      setSaved(true); setEditing(false);
    });
  };

  if (changing) return <ChangePassword onClose={() => setChanging(false)} onDone={() => { setChanging(false); onClose(); }} />;
  if (removing) {
    return (
      <Confirm title="Remove this member" action="Remove" danger busy={busy} onClose={() => setRemoving(false)}
        onConfirm={() => run(async () => { await api('admin.delete', { id: member.id }); onChanged(); onClose(); })}>
        <p>{member.display_name} will no longer be able to sign in. This cannot be undone.</p>
        {!fallen && <p className="hint">If their character has died, give them the Deceased tag instead. They keep their account and move to the Deceased screen.</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </Confirm>
    );
  }
  // The fallen have no online status: what is left of them is on the card.
  const top = (
    <div className="member__top">
      <Tags tags={member.tags} />
      {!fallen && <span className="roster__status">
        {st.status !== 'unknown' && !(onApp && st.status === 'offline') && <span className={`presence presence--${st.status}`} title={STATUS[st.status][1]}>{STATUS[st.status][0]}</span>}
        {onApp && <span className="presence presence--app" title={ON_APP}>On the app</span>}
      </span>}
    </div>
  );
  if (!editing) {
    return (
      <Modal title={member.display_name} onClose={onClose}>
        {top}
        {fallen ? <Fallen member={member} /> : <About member={member} own={self} />}
        {member.discord_name && <p className="muted" style={{ marginTop: 12 }}>Discord: {member.discord_name}</p>}
        {saved && <p className="note" role="status">Saved.</p>}
        <div className="row" style={{ marginTop: 16 }}>
          {/* a gesture for whoever reads a fallen clanmate's card; not one to make at your own */}
          {fallen && !self && <PayRespect name={member.display_name} />}
          <span style={{ flex: 1 }} />
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
          <small>The nickname as it shows in the clan Discord's member list, not the username or Name#0000. Leave it blank if it is the same as the name above. This is how the Members screen knows who is online.</small>
        </label>
        {self && !fallen && (
          <label className="field"><span>Bio</span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 500))} maxLength={500} rows={4} placeholder="Who is your character? What do you do for the clan?" />
            <small className={bio.length >= 480 ? 'is-near' : ''}>{bio.length} of 500 characters</small>
          </label>
        )}
        {fallen && canManage && <>
          <label className="field"><span>Passage of honor</span>
            <textarea value={honor} onChange={(e) => setHonor(e.target.value.slice(0, 1000))} maxLength={1000} rows={5} placeholder="Words in honor of the fallen: who they were to the clan, and what they are remembered for." />
            <small className={honor.length >= 960 ? 'is-near' : ''}>{honor.length} of 1000 characters</small>
          </label>
          <label className="field"><span>Cause of death</span>
            <textarea value={cause} onChange={(e) => setCause(e.target.value.slice(0, 500))} maxLength={500} rows={4} placeholder="How did this character meet their end?" />
            <small className={cause.length >= 480 ? 'is-near' : ''}>{cause.length} of 500 characters</small>
          </label>
          <div className="field">
            <span>Date of passing</span>
            <div className="row fallen__when">
              <input className="input" type="date" aria-label="Date of passing" value={dateUnknown ? '' : died} max={new Date(Date.now() + 864e5).toISOString().slice(0, 10)}
                disabled={dateUnknown} onChange={(e) => setDied(e.target.value)} />
              <label className="check"><input type="checkbox" checked={dateUnknown} onChange={(e) => setDateUnknown(e.target.checked)} />Date unknown</label>
            </div>
            <small>Leave it empty until the date is known. Tick Date unknown and the card reads UNKNOWN.</small>
          </div>
        </>}
        {fallen && !canManage && <p className="hint">This character has fallen. The passage of honor, the cause of death and the date of passing are recorded by the clan's officers.</p>}
        {(self || canManage) && <>
          <span className="label">Masteries</span>
          <MasteryPicker value={masteries} onChange={setMasteries} />
          {!self && !fallen && <p className="hint">As an officer you can set {member.display_name}'s masteries. Their bio and hours are theirs to write.</p>}
        </>}
        {self && !fallen && <AvailabilityEditor week={week} zone={zone} onWeek={setWeek} onZone={setZone} />}
        {canManage && <>
          <label className="field"><span>Sign-in name</span>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!smith} autoCapitalize="none" spellCheck={false} />
            {!smith && <small>Only a Forgemaster can change a sign-in name.</small>}
          </label>
          <span className="label">Tags</span>
          <TagPicker value={tags} onChange={setTags} mine={me.tags} />
          {tags.includes('deceased') !== fallen && <p className="hint">{fallen
            ? `Saving without the Deceased tag moves ${member.display_name} back to Members.`
            : `Saving with the Deceased tag moves ${member.display_name} from Members to Deceased, where a passage of honor, the cause of death and the date of passing are recorded.`}</p>}
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

/** The signed-in member's own card, for Profile on the main menu. It looks up who is online for itself. */
export default function ProfileCard({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth();
  const [presence, setPresence] = useState<Presence | null>(null);
  const fallen = isFallen(profile?.tags);
  useEffect(() => { if (!fallen) api<Presence>('discord.presence').then(setPresence).catch(() => undefined); }, [fallen]);
  if (!profile) return null;
  // Your own save already refreshes your profile, and a tag change simply shows on the card.
  return <MemberCard member={profile} me={profile} presence={presence} onApp={!fallen} onClose={onClose} onChanged={() => undefined} />;
}
