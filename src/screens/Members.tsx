import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { api, supabase } from '../lib/supabase';
import { TAGS, isFallen, isForgemaster, isOfficer, sortTags, standing } from '../lib/roles';
import { PROFILE_COLUMNS, type Profile } from '../lib/types';
import { ClanTags, Modal, Page } from '../components/ui';
import { CLAN, CLANS, currentSide, sortClans, type Clan } from '../lib/clan';
import { sfx } from '../lib/sound';
import { Masteries } from '../components/Mastery';
import { cleanMasteries } from '../lib/masteries';
import { ClanPicker, MemberCard, ON_APP, STATUS, Secret, TagPicker, discordKey, norm, statusOf, type Presence, type Status } from '../components/MemberCard';

/** Online first: in the realm, then in Discord or on the app, then everyone else. */
const onlineRank = (st: Status, onApp: boolean) => (st === 'realm' ? 0 : st === 'discord' || onApp ? 1 : 2);

function AddMember({ me, onClose, onAdded }: { me: Profile; onClose: () => void; onAdded: () => void }) {
  const [username, setUsername] = useState(''); const [display, setDisplay] = useState(''); const [discord, setDiscord] = useState('');
  const [tags, setTags] = useState<string[]>(['unblooded']);
  // A new member joins the clan of the officer adding them. The Forgemaster picks any clan; an officer of both clans picks between theirs.
  const allowed: Clan[] = isForgemaster(me.tags) ? CLANS : sortClans(me.clans).length ? sortClans(me.clans) : ['black_tusks'];
  const [clans, setClans] = useState<Clan[]>(() => [allowed.includes(currentSide()) ? currentSide() : allowed[0]]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ profile: Profile; password: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      setMade(await api('admin.create', { username, display_name: display, discord_name: discord, tags, clans }));
      sfx('save'); onAdded();
    } catch (err) { sfx('denied'); setError((err as Error).message); } finally { setBusy(false); }
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
        <span className="label">Clan</span>
        {allowed.length > 1 ? <ClanPicker value={clans} onChange={setClans} allowed={allowed} />
          : <div className="clanpick"><ClanTags clans={allowed} /><small className="muted">New members you add join your clan.</small></div>}
        <span className="label">Tags</span>
        <TagPicker value={tags} onChange={setTags} mine={me.tags} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row row--end" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--go" disabled={busy}>{busy ? 'Adding…' : 'Add member'}</button>
        </div>
      </form>
    </Modal>
  );
}

// Where each clan's Discord Server ID is kept.
const GUILD_KEY: Record<Clan, string> = { black_tusks: 'discord_guild_id', scorned: 'discord_guild_id_scorned' };

function DiscordSetup({ presence, members, onClose, onSaved }: { presence: Presence | null; members: Profile[]; onClose: () => void; onSaved: () => void }) {
  const known = new Set(members.map(discordKey));
  const strangers = presence?.ok ? presence.members.filter((m) => !known.has(norm(m.name))).map((m) => m.name) : [];
  const [ids, setIds] = useState<Record<Clan, string>>({ black_tusks: '', scorned: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  // The saved IDs arrive a moment after the pop-up opens; they must not wipe out one that is already being typed.
  const typed = useRef<Set<Clan>>(new Set());
  useEffect(() => {
    supabase.from('app_settings').select('key, value').in('key', Object.values(GUILD_KEY)).then(({ data }) => {
      setIds((was) => {
        const next = { ...was };
        for (const c of CLANS) if (!typed.current.has(c)) next[c] = String(data?.find((r: { key: string }) => r.key === GUILD_KEY[c])?.value ?? '');
        return next;
      });
    });
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    for (const c of CLANS) {
      const clean = ids[c].replace(/\D/g, '');
      const { error } = clean
        ? await supabase.from('app_settings').upsert({ key: GUILD_KEY[c], value: clean })
        : await supabase.from('app_settings').delete().eq('key', GUILD_KEY[c]);
      if (error) { setBusy(false); sfx('denied'); return setError(error.message); }
    }
    setBusy(false); setDone(true); sfx('save'); onSaved();
  };
  const state = (c: Clan) => presence?.servers?.find((x) => x.clan === c);
  return (
    <Modal title="Discord link" onClose={onClose}>
      <form onSubmit={save}>
        <p style={{ marginBottom: 10 }}>Each clan can link its own Discord. Who is online is read from both.</p>
        <ol className="steps">
          <li>In the clan's Discord, open <strong>Server Settings</strong>, then <strong>Engagement</strong>, and under Server Widget turn on <strong>Enable Server Widget</strong>.</li>
          <li>Copy the <strong>Server ID</strong> shown on that same page and paste it below, beside that clan.</li>
          <li>A member whose nickname in their clan's Discord is the same as their name here needs nothing more. Anyone else puts that nickname on their profile as their Discord name. Members can do this themselves.</li>
        </ol>
        {CLANS.map((c) => {
          const st = state(c);
          return (
            <label className="field" key={c}><span>{CLAN[c].title}: Server ID</span>
              <input type="text" inputMode="numeric" value={ids[c]} onChange={(e) => { typed.current.add(c); setIds((was) => ({ ...was, [c]: e.target.value })); }} placeholder="18 or 19 digits" />
              {st?.configured && st.ok === false && <small className="error">{st.reason}</small>}
              {st?.configured && st.ok && <small className="note">Connected to {st.server}. {st.online ?? 0} online right now.</small>}
              {!st?.configured && <small>Not linked yet.</small>}
            </label>
          );
        })}
        <p className="hint">A member shows as in the realm when Discord reports them playing Skyrim. Discord cannot tell Daedric Online from single-player Skyrim, and members who hide their game activity show as in Discord only.</p>
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
type Filter = 'all' | Clan;
const FILTERS: [Filter, string][] = [['all', 'All Members'], ['black_tusks', 'Black Tusks Only'], ['scorned', 'Scorned Only']];
const FILTER_KEY = 'bt-members-filter';

export function Roster({ fallen = false, clan }: { fallen?: boolean; clan?: Clan }) {
  const { profile } = useAuth(); const me = profile!; const officer = isOfficer(me.tags);
  // Members: everyone, or one clan (remembered for the session). Deceased: one clan's fallen.
  const [filter, setFilterState] = useState<Filter>(() => {
    try { const f = sessionStorage.getItem(FILTER_KEY); return f === 'black_tusks' || f === 'scorned' ? f : 'all'; } catch { return 'all'; }
  });
  const setFilter = (f: Filter) => { setFilterState(f); sfx('hover'); try { sessionStorage.setItem(FILTER_KEY, f); } catch { /* kept for this visit only */ } };
  const only: Filter = fallen ? clan ?? 'black_tusks' : filter;
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

  const members = useMemo(() => everyone?.filter((m) => isFallen(m.tags) === fallen && (only === 'all' || !!m.clans?.includes(only))) ?? null, [everyone, fallen, only]);
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
    <Page title={fallen ? 'Deceased' : 'Members'} sub={fallen ? <>{CLAN[only as Clan].title}{sub ? `, ${sub}` : ''}</> : sub}
      bar={!fallen && <>
        {isForgemaster(me.tags) && <button className="btn" onClick={() => setDiscord(true)}>Discord link</button>}
        {isOfficer(me.tags) && <button className="btn btn--go" onClick={() => setAdding(true)}>Add member</button>}
      </>}>
      {!fallen && <div className="tabs tabs--clans" role="tablist" aria-label="Show">
        {FILTERS.map(([f, label]) => (
          <button key={f} role="tab" aria-selected={filter === f} className={`tabs__one ${filter === f ? 'is-on' : ''}`} onClick={() => setFilter(f)}>{label}</button>
        ))}
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {moved && <p className="note" role="status">{moved}</p>}
      {!members && !error && <p className="empty">{fallen ? 'Reading the names of the fallen…' : 'Counting heads…'}</p>}
      {members && !fallen && members.length === 0 && everyone && <p className="empty">No members in this clan yet.</p>}
      {members && fallen && members.length === 0 && <p className="empty">{only === 'scorned' ? 'No Scorned has fallen.' : 'No Black Tusk has fallen.'}{officer ? ' When a character dies, give them the Deceased tag on the Members screen and they will be listed here.' : ''}</p>}
      {members && members.length > 0 && (
        <ul className={`roster ${fallen ? 'roster--fallen' : ''}`}>
          {sorted.map((m) => {
            const st = statusOf(m, presence); const here = onApp.has(m.id);
            return (
              <li key={m.id}>
                <button className="roster__row" onClick={() => { setMoved(''); setOpen(m.id); }}>
                  {!fallen && <span className={`dot dot--${st.status} ${here ? 'dot--app' : ''}`} aria-hidden="true" />}
                  <span className="roster__name">{m.display_name}{m.id === me.id && <em> (you)</em>}</span>
                  <span className="roster__tags"><ClanTags clans={m.clans} /><span className="tags">{sortTags(m.tags).map((t) => <span key={t} className="tag" style={{ ['--c' as any]: TAGS.find((x) => x.id === t)?.color }}>{TAGS.find((x) => x.id === t)?.label}</span>)}</span>
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
      {adding && <AddMember me={me} onClose={() => setAdding(false)} onAdded={load} />}
      {discord && <DiscordSetup presence={presence} members={everyone ?? []} onClose={() => setDiscord(false)} onSaved={loadPresence} />}
    </Page>
  );
}

export default function Members() { return <Roster />; }
