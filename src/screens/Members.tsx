import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { api, supabase } from '../lib/supabase';
import { TAGS, isFallen, isForgemaster, isOfficer, sortTags, standing } from '../lib/roles';
import { PROFILE_COLUMNS, type Profile } from '../lib/types';
import { Modal, Page } from '../components/ui';
import { Masteries } from '../components/Mastery';
import { cleanMasteries } from '../lib/masteries';
import { MemberCard, ON_APP, STATUS, Secret, TagPicker, discordKey, norm, statusOf, type Presence, type Status } from '../components/MemberCard';

/** Online first: in the realm, then in Discord or on the app, then everyone else. */
const onlineRank = (st: Status, onApp: boolean) => (st === 'realm' ? 0 : st === 'discord' || onApp ? 1 : 2);

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
        {isFallen(made.profile.tags) && <p className="hint">{made.profile.display_name} carries the Deceased tag, so they are listed on the Deceased screen, not here.</p>}
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
          <small>Their nickname as it shows in the clan Discord's member list, not their username or Name#0000. Leave it blank if it is the same as their name here. Used for online status.</small>
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

function DiscordSetup({ presence, members, onClose, onSaved }: { presence: Presence | null; members: Profile[]; onClose: () => void; onSaved: () => void }) {
  const known = new Set(members.map(discordKey));
  const strangers = presence?.ok ? presence.members.filter((m) => !known.has(norm(m.name))).map((m) => m.name) : [];
  const [id, setId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  // The saved ID arrives a moment after the pop-up opens; it must not wipe out one that is already being typed.
  const typed = useRef(false);
  useEffect(() => { supabase.from('app_settings').select('value').eq('key', 'discord_guild_id').maybeSingle().then(({ data }) => { if (!typed.current) setId(String(data?.value ?? '')); }); }, []);
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
          <li>In the clan Discord, open <strong>Server Settings</strong>, then <strong>Engagement</strong>, and under Server Widget turn on <strong>Enable Server Widget</strong>.</li>
          <li>Copy the <strong>Server ID</strong> shown on that same page and paste it here.</li>
          <li>A member whose nickname in the clan Discord is the same as their name here needs nothing more. Anyone else puts that nickname on their profile as their Discord name. Members can do this themselves.</li>
        </ol>
        <label className="field"><span>Server ID</span>
          <input type="text" inputMode="numeric" value={id} onChange={(e) => { typed.current = true; setId(e.target.value); }} placeholder="18 or 19 digits" />
        </label>
        <p className="hint">A member shows as in the realm when Discord reports them playing Skyrim. Discord cannot tell Daedric Online from single-player Skyrim, and members who hide their game activity show as in Discord only.</p>
        {presence?.configured && presence.ok === false && <p className="error">{presence.reason}</p>}
        {presence?.ok && <p className="note">Connected to {presence.server}. {presence.members.length} online right now.</p>}
        {presence?.ok && presence.members.length > 0 && (
          <p className="hint">Names as Discord reports them right now: {presence.members.map((m) => m.name).join(', ')}.
            A member's name here, or the Discord name on their profile, has to match one of these (capitals do not matter).
            {strangers.length > 0 ? ` Online in Discord but matching no member here: ${strangers.join(', ')}.` : ''}
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

/** The list behind Members and behind Deceased. The two are the same screen over different members:
 *  whoever carries the Deceased tag is listed under Deceased and nowhere else. */
export function Roster({ fallen = false }: { fallen?: boolean }) {
  const { profile } = useAuth(); const me = profile!; const officer = isOfficer(me.tags);
  const [everyone, setEveryone] = useState<Profile[] | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [onApp, setOnApp] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null); const [adding, setAdding] = useState(false); const [discord, setDiscord] = useState(false);
  const [error, setError] = useState(''); const [moved, setMoved] = useState('');

  const load = useCallback(async () => {
    // Officers get the full rows (sign-in names included); everyone else the public columns.
    const { data, error } = officer ? await supabase.rpc('member_admin_list') : await supabase.from('profiles').select(PROFILE_COLUMNS);
    if (error) setError('Could not load the members. Check your connection and try again.'); else { setError(''); setEveryone(data as Profile[]); }
  }, [officer]);
  const loadPresence = useCallback(() => {
    api<Presence>('discord.presence').then(setPresence).catch(() => setPresence(null));
    // who has the app itself open (you always do, or you would not be reading this)
    supabase.rpc('app_online').then(({ data, error }) => { if (!error) setOnApp(new Set([...((data as string[] | null) ?? []), me.id])); }, () => undefined);
  }, [me.id]);
  // The fallen have no online status, so their list never asks who is about.
  useEffect(() => { void load(); if (fallen) return; loadPresence(); const t = setInterval(loadPresence, 30000); return () => clearInterval(t); }, [load, loadPresence, fallen]);

  const members = useMemo(() => everyone?.filter((m) => isFallen(m.tags) === fallen) ?? null, [everyone, fallen]);
  // Whoever is about comes first: in the realm, then in Discord or on the app, then the rest. Within each, by standing, then name.
  // The fallen are listed by the standing they held, then name.
  const sorted = useMemo(() => [...(members ?? [])].sort((a, b) =>
    (fallen ? 0 : onlineRank(statusOf(a, presence).status, onApp.has(a.id)) - onlineRank(statusOf(b, presence).status, onApp.has(b.id)))
    || standing(a.tags) - standing(b.tags) || a.display_name.localeCompare(b.display_name)), [members, presence, onApp, fallen]);
  const inRealm = sorted.filter((m) => statusOf(m, presence).status === 'realm').length;
  const appCount = sorted.filter((m) => onApp.has(m.id)).length;
  const current = sorted.find((m) => m.id === open);
  const live = presence?.configured && presence.ok !== false;
  const sub = !members ? undefined : fallen
    ? `${members.length} fallen`
    : `${members.length} by the fire${live ? `, ${inRealm} in the realm now` : ''}${appCount ? `, ${appCount} on the app` : ''}`;

  return (
    <Page title={fallen ? 'Deceased' : 'Members'} sub={sub}
      bar={!fallen && <>
        {isForgemaster(me.tags) && <button className="btn" onClick={() => setDiscord(true)}>Discord link</button>}
        {isOfficer(me.tags) && <button className="btn btn--go" onClick={() => setAdding(true)}>Add member</button>}
      </>}>
      {error && <p className="error" role="alert">{error}</p>}
      {moved && <p className="note" role="status">{moved}</p>}
      {!members && !error && <p className="empty">{fallen ? 'Reading the names of the fallen…' : 'Counting heads…'}</p>}
      {members && fallen && members.length === 0 && <p className="empty">No Black Tusk has fallen.{officer ? ' When a character dies, give them the Deceased tag on the Members screen and they will be listed here.' : ''}</p>}
      {members && members.length > 0 && (
        <ul className={`roster ${fallen ? 'roster--fallen' : ''}`}>
          {sorted.map((m) => {
            const st = statusOf(m, presence); const here = onApp.has(m.id);
            return (
              <li key={m.id}>
                <button className="roster__row" onClick={() => { setMoved(''); setOpen(m.id); }}>
                  {!fallen && <span className={`dot dot--${st.status} ${here ? 'dot--app' : ''}`} aria-hidden="true" />}
                  <span className="roster__name">{m.display_name}{m.id === me.id && <em> (you)</em>}</span>
                  <span className="roster__tags"><span className="tags">{sortTags(m.tags).map((t) => <span key={t} className="tag" style={{ ['--c' as any]: TAGS.find((x) => x.id === t)?.color }}>{TAGS.find((x) => x.id === t)?.label}</span>)}</span>
                    <Masteries list={cleanMasteries(m.masteries)} mini /></span>
                  {!fallen && <span className="roster__status">
                    {/* someone with the app open is not "offline", whatever Discord says */}
                    {st.status !== 'unknown' && !(here && st.status === 'offline') && <span className={`presence presence--${st.status}`}>{STATUS[st.status][0]}</span>}
                    {here && <span className="presence presence--app" title={ON_APP}>On the app</span>}
                  </span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {members && !fallen && !live && <p className="hint" style={{ textAlign: 'center', marginTop: 18 }}>
        {presence?.configured ? presence.reason : isForgemaster(me.tags) ? 'Online status is off until the clan Discord is linked. Use Discord link below.' : 'Online status appears here once the Forgemaster links the clan Discord.'}
      </p>}
      {current && <MemberCard key={current.id} member={current} me={me} presence={presence} onApp={onApp.has(current.id)} onClose={() => setOpen(null)} onChanged={load}
        onMoved={(name, nowFallen) => { setOpen(null); setMoved(nowFallen ? `${name} now rests among the Deceased. Their card is on the Deceased screen.` : `${name} is back on the Members screen.`); }} />}
      {adding && <AddMember mine={me.tags} onClose={() => setAdding(false)} onAdded={load} />}
      {discord && <DiscordSetup presence={presence} members={everyone ?? []} onClose={() => setDiscord(false)} onSaved={loadPresence} />}
    </Page>
  );
}

export default function Members() { return <Roster />; }
