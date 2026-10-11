import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_VERSION } from '../config';
import { useAuth } from '../lib/auth';
import { Banner, Scene } from '../components/Scene';
import { Modal, Tags } from '../components/ui';
import { splashHold, splashPass } from '../lib/splash';

const MEMBER_MENU: [string, string][] = [
  ['Code of Mauloch', '/code'],
  ['Notice Board', '/notices'],
  ['Black Tusk Oath', '/oath'],
  ['Members', '/members'],
  ['Mine of the Black Tusks', '/mine'],
  ['Expansion Goals', '/expansion'],
  ['Mining Map', '/map'],
  ['Pricing Ledger', '/ledger'],
];

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

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

export default function MainMenu() {
  const { profile, signOut } = useAuth();
  const go = useNavigate();
  const nav = useRef<HTMLUListElement>(null);
  const [install, setInstall] = useState(false);
  useEffect(() => { document.title = 'Black Tusk Companion'; }, []);
  // On the way in, the loading screen also waits for the picture behind the menu and for the banner.
  useState(() => { splashHold('menu-scene'); splashHold('menu-banner'); return 0; });

  // Arrow keys move through the menu, as on the game's own title screen.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(nav.current?.querySelectorAll<HTMLElement>('.menu__item') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus(); e.preventDefault();
  };

  const items: [string, () => void, boolean?][] = profile
    ? [['Sign Out', () => { void signOut(); }, true], ...MEMBER_MENU.map(([label, to]) => [label, () => go(to)] as [string, () => void])]
    : [['Sign In', () => go('/sign-in')], ['Code of Mauloch', () => go('/code')]];

  return (
    <>
      <Scene onReady={() => splashPass('menu-scene')} />
      <div className="menu">
        <div className="menu__banner"><Banner onReady={() => splashPass('menu-banner')} /></div>
        <div className="menu__side">
          <ul className="menu__nav" ref={nav} onKeyDown={onKey} aria-label="Main menu">
            {items.map(([label, act, quiet]) => (
              <li key={label}><button className={`menu__item ${quiet ? 'menu__item--quiet' : ''}`} onClick={act}>{label}</button></li>
            ))}
          </ul>
          <div className="menu__foot">
            <div>
              {profile && <div className="menu__who"><span>{profile.display_name}</span><Tags tags={profile.tags} /></div>}
              <div>Black Tusk Companion {APP_VERSION}</div>
            </div>
            {!standalone() && <button className="menu__install" onClick={() => setInstall(true)}>Add to home screen</button>}
          </div>
        </div>
      </div>
      {install && <InstallHelp onClose={() => setInstall(false)} />}
    </>
  );
}
