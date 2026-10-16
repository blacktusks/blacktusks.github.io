// Phones are held upright. Where the system allows it (an installed app on Android) the screen is
// locked that way; everywhere else a phone turned on its side is covered with a request to turn it
// back. Tablets and computers are left alone: the cover is only for small touch screens on their side.
import { useEffect } from 'react';

export function TurnUpright() {
  useEffect(() => {
    const isPhone = () => window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 560;
    const lock = () => {
      if (!isPhone()) return;
      const o = (window.screen as any).orientation;
      // refused outside an installed app or full screen; the cover below handles those
      try { void o?.lock?.('portrait')?.catch?.(() => undefined); } catch { /* not allowed here */ }
    };
    lock();
    document.addEventListener('visibilitychange', lock);
    return () => document.removeEventListener('visibilitychange', lock);
  }, []);
  return (
    <div className="upright" role="alertdialog" aria-label="Turn your phone upright">
      <div className="upright__phone" aria-hidden="true"><i /></div>
      <p className="upright__title">Turn your phone upright</p>
      <p className="upright__note">The companion is made to be held upright.</p>
    </div>
  );
}
