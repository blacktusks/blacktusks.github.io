// Getting a new build onto a device.
//
// The service worker keeps the app working offline, which also means a device
// can go on showing an old build. A new service worker takes over as soon as it
// is installed; this file notices that and reloads the page, so the screen in
// front of the member is the new build too. If they are in the middle of
// something (a form or a pop-up is open), a bar offers a Reload button instead
// so nothing half-typed is lost. It also asks for updates when the app comes
// back to the front, not only when it is first opened.
const READY = 'black-tusk-update-ready';

const busy = () => !!document.querySelector('.modal, .sheet')
  || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');

export function watchForUpdates() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  let controlled = !!navigator.serviceWorker.controller, reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }      // the very first install: there is no older build on screen
    if (reloading) return;
    if (busy()) window.dispatchEvent(new Event(READY));
    else { reloading = true; window.location.reload(); }
  });
  navigator.serviceWorker.ready.then((registration) => {
    const check = () => { if (document.visibilityState === 'visible') registration.update().catch(() => undefined); };
    document.addEventListener('visibilitychange', check);
    window.setInterval(check, 20 * 60 * 1000);
  }).catch(() => undefined);
}
export const onUpdateReady = (fn: () => void) => { window.addEventListener(READY, fn); return () => window.removeEventListener(READY, fn); };
export const reloadIntoUpdate = () => { window.location.reload(); };
