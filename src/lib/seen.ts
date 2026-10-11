// "On the app": while a signed-in member has the app in front of them, it tells
// the backend so once a minute. The Members screen asks who has said so lately.
// Nothing is sent while the app is in the background, so a phone in a pocket
// drops off the list within a couple of minutes.
import { supabase } from './supabase';

const EVERY_MS = 60_000;
let timer: number | undefined, running = false;

const beat = () => { if (running && document.visibilityState === 'visible') void supabase.rpc('touch_seen').then(() => undefined, () => undefined); };

export function startSeen() {
  if (running) return;
  running = true;
  beat();
  timer = window.setInterval(beat, EVERY_MS);
  document.addEventListener('visibilitychange', beat);
  window.addEventListener('pageshow', beat);
}

export function stopSeen() {
  if (!running) return;
  running = false;
  window.clearInterval(timer);
  document.removeEventListener('visibilitychange', beat);
  window.removeEventListener('pageshow', beat);
}

/** Signing out: come off the list at once. Must be called while still signed in. */
export const leaveApp = () => supabase.rpc('leave_app').then(() => undefined, () => undefined);
