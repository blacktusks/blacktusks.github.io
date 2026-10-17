import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_VERSION } from '../config';
import { useAuth } from '../lib/auth';
import { CLAN, clanPath, otherClan, setSide, useSide, type Clan } from '../lib/clan';
import { Banner, Scene } from '../components/Scene';
import { ClanTags, Modal, Tags } from '../components/ui';
import { splashHold, splashPass } from '../lib/splash';
import { setSound, sfx, useSound, type Sfx } from '../lib/sound';

// The member's own card is only fetched when Profile is first opened.
const ProfileCard = lazy(() => import('../components/MemberCard'));

/** The menu for a clan's side of the app. Members, Roles, the Mining Map and the Pricing Ledger are shared;
 *  the Notice Board, oath, Deceased, mine and Expansion Goals are each clan's own. */
const memberMenu = (c: Clan): [string, string][] => [
  ['Code of Mauloch', '/code'],
  ['Notice Board', clanPath(c, '/notices')],
  [`${CLAN[c].adj} Oath`, clanPath(c, '/oath')],
  ['Members', '/members'],
  ['Deceased', clanPath(c, '/deceased')],
  ['Roles', '/roles'],
  [CLAN[c].mine, clanPath(c, '/mine')],
  ['Expansion Goals', clanPath(c, '/expansion')],
  ['Mining Map', '/map'],
  ['Pricing Ledger', '/ledger'],
];

/** Signed out, the menu shows each clan in turn, this long. */
const CYCLE_MS = 9000;
/** A switch: the banner sinks into fog, then the other rises out of it. The strongholds crossfade meanwhile. */
const FOG_OUT_MS = 900, FOG_IN_MS = 1300;

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function InstallHelp({ onClose }: { onClose: () => void }) {
  const prompt = (window as any).__installPrompt;
  return (
    <Modal title="Add to your home screen" onClose={onClose} foot={<button className="btn btn--go" onClick={onClose}>Done</button>}>
      <p style={{ marginBottom: 14 }}>Once it is on your home screen, the companion opens full screen like any other app.</p>
      <p className="label">iPhone and iPad</p>
      <p style={{ marginBottom: 14 }}>Open this page in Safari, tap the Share button, then choose <strong>Add to Home Screen</strong>.</p>
      <p className="label">Android</p>
      <p style={{ marginBottom: 14 }}>Open this page in Chrome, tap the three-dot menu, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
      {prompt && <button className="btn btn--go" onClick={() => { prompt.prompt(); onClose(); }}>Install now</button>}
      <p className="label" style={{ marginTop: 14 }}>Computer</p>
      <p>In Chrome or Edge, use the install icon at the right end of the address bar.</p>
    </Modal>
  );
}

/**
 * Which clan the menu shows, and the switch between them. Signed in, it follows the side of the app the member
 * is on. Signed out, it starts at the Black Tusks and turns to the Scorned and back, over and over.
 * `shown` (banner, title, menu) trails `want` (the stronghold behind) by the time the banner spends in the fog.
 */
function useClanShown(signedIn: boolean) {
  const side = useSide();
  const [cycle, setCycle] = useState<Clan>('black_tusks');
  useEffect(() => {
    if (signedIn) return;
    setCycle('black_tusks');
    const t = window.setInterval(() => setCycle(otherClan), CYCLE_MS);
    return () => window.clearInterval(t);
  }, [signedIn]);
  const want: Clan = signedIn ? side : cycle;
  const [shown, setShown] = useState<Clan>(want);
  const shownRef = useRef(shown); shownRef.current = shown;
  const [phase, setPhase] = useState<'' | 'out' | 'in'>('');
  useEffect(() => {
    if (reducedMotion()) { setShown(want); setPhase(''); return; }
    if (want === shownRef.current) {
      // turned back before the swap: the same banner simply rises out of the fog again
      setPhase((p) => (p ? 'in' : ''));
      const t = window.setTimeout(() => setPhase(''), FOG_IN_MS);
      return () => window.clearTimeout(t);
    }
    setPhase('out');
    const a = window.setTimeout(() => { setShown(want); setPhase('in'); }, FOG_OUT_MS);
    const b = window.setTimeout(() => setPhase(''), FOG_OUT_MS + FOG_IN_MS);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [want]);
  return { want, shown, phase };
}

export default function MainMenu() {
  const { profile, signOut } = useAuth();
  const go = useNavigate();
  const nav = useRef<HTMLUListElement>(null);
  const [install, setInstall] = useState(false); const [card, setCard] = useState(false);
  const { want, shown, phase } = useClanShown(!!profile);
  useEffect(() => { document.title = 'Black Tusk Companion'; }, []);
  // On the way in, the loading screen also waits for the picture behind the menu and for the banner.
  useState(() => { splashHold('menu-scene'); splashHold('menu-banner'); return 0; });

  // Arrow keys move through the menu, as on the game's own title screen.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(nav.current?.querySelectorAll<HTMLElement>('.menu__item') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus(); e.preventDefault(); sfx('hover');
  };
  const sound = useSound();

  const other = otherClan(shown);
  type Item = [string, () => void, string?, Sfx?];      // label, what it does, look, the sound it makes
  // Settings sits just below Sign Out (small, like it), or below Sign In before anyone signs in.
  const items: Item[] = profile
    ? [['Sign Out', () => { void signOut(); }, 'quiet', 'back'], ['Settings', () => go('/settings'), 'quiet'], ['Profile', () => setCard(true)],
       ...memberMenu(shown).map(([label, to]) => [label, () => go(to)] as Item),
       [`Visit ${CLAN[other].title}`, () => setSide(other), 'visit', 'switch']]
    : [['Sign In', () => go('/sign-in')], ['Settings', () => go('/settings')], ['Code of Mauloch', () => go('/code')]];
  const button = ([label, act, kind, sound]: Item) => (
    <button key={label} className={`menu__item ${kind ? `menu__item--${kind}` : ''}`} disabled={!!phase && kind === 'visit'}
      onClick={() => { sfx(sound ?? 'select'); act(); }}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') sfx('hover'); }}>{label}</button>
  );

  return (
    <>
      <Scene theme={want} onReady={() => splashPass('menu-scene')} />
      <div className={`menu menu--${shown} ${phase ? `is-fog-${phase}` : ''}`}>
        <div className="menu__banner">
          <h1 className="menu__title" aria-live="polite">{CLAN[shown].title}</h1>
          <div className="menu__flag">
            <Banner theme={shown} onReady={() => splashPass('menu-banner')} />
            <div className="menu__fog" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
          </div>
        </div>
        <div className="menu__side">
          {/* the list sizes itself by how many lines it holds, so a longer list still fits the screen */}
          {/* the two small lines at the top count as one when the list sizes itself */}
          <ul className="menu__nav" ref={nav} onKeyDown={onKey} aria-label="Main menu" style={{ ['--n' as any]: profile ? items.length - 1 : items.length }}>
            {items.map((it) => <li key={it[0]}>{button(it)}</li>)}
          </ul>
          <div className="menu__foot">
            <div>
              {profile && <div className="menu__who"><span>{profile.display_name}</span><ClanTags clans={profile.clans} /><Tags tags={profile.tags} /></div>}
              <div>Black Tusk Companion {APP_VERSION}</div>
            </div>
            <span className="menu__tools">
              {!standalone() && <button className="menu__install" onClick={() => setInstall(true)}>Add to home screen</button>}
              <button className={`menu__sound ${sound.muted ? 'is-muted' : ''}`} aria-pressed={!sound.muted} aria-label={sound.muted ? 'Turn sound on' : 'Turn sound off'}
                title={sound.muted ? 'Sound is off' : 'Sound is on'} onClick={() => { setSound({ muted: !sound.muted }); if (sound.muted) window.setTimeout(() => sfx('select'), 60); }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" />
                  {sound.muted ? <path d="M16 9l5 6M21 9l-5 6" className="menu__sound-x" /> : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" className="menu__sound-w" />}</svg>
              </button>
            </span>
          </div>
        </div>
      </div>
      {install && <InstallHelp onClose={() => setInstall(false)} />}
      {card && profile && <Suspense fallback={null}><ProfileCard onClose={() => setCard(false)} /></Suspense>}
    </>
  );
}
