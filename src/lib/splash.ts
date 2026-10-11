// The loading screen (it lives in index.html, so it is on screen before this file runs).
//
// It stays up until every "gate" has been passed: the fonts are in, the member's
// session is known, the first screen has been drawn, and that screen's own
// pictures have arrived. Then the layout is given a moment to stop moving (phone
// browsers resize the page while their bars settle) and the loading screen fades
// out. Whatever happens, it goes after a while, so nobody is left staring at it.
const GATES = ['fonts', 'session', 'screen'] as const;
type Gate = (typeof GATES)[number] | string;

const open = new Set<Gate>(GATES);
let total = open.size, gone = false, settling = false;
const el = () => document.getElementById('splash');
const LIMIT_MS = 12000;

function progress() {
  const done = total - open.size;
  el()?.style.setProperty('--p', `${Math.round(8 + (92 * done) / Math.max(1, total))}%`);
}

function remove() {
  if (gone) return;
  gone = true;
  const s = el(); if (!s) return;
  s.classList.add('is-done');
  const drop = () => s.remove();
  s.addEventListener('transitionend', drop, { once: true });
  window.setTimeout(drop, 700);
  document.documentElement.classList.add('is-loaded');
}

/** Wait until the page has kept one size for a few frames, then lift the loading screen. */
function settle() {
  if (settling || gone) return;
  settling = true;
  const size = () => `${Math.round(window.visualViewport?.width ?? window.innerWidth)}x${Math.round(window.visualViewport?.height ?? window.innerHeight)}`;
  let last = size(), same = 0, frames = 0;
  const tick = () => {
    const now = size(); frames++;
    if (now === last) same++; else { same = 0; last = now; }
    if (same >= 4 || frames > 90) remove(); else requestAnimationFrame(tick);
  };
  // A tab opened in the background draws no frames, so there is nothing to wait for there.
  if (document.hidden) { remove(); return; }
  requestAnimationFrame(tick);
  window.setTimeout(remove, 1800);
}

/** Add something the loading screen must wait for. Does nothing once it has gone. */
export function splashHold(gate: Gate) {
  if (gone || settling || open.has(gate)) return;
  open.add(gate); total++; progress();
}
/** Say that one of the things the loading screen waits for is done. */
export function splashPass(gate: Gate) {
  if (!open.delete(gate)) return;
  progress();
  if (!open.size) settle();
}
export const splashGone = () => gone;

window.setTimeout(remove, LIMIT_MS);
progress();
