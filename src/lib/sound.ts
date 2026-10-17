// The app's sound: a looping theme for whoever is looking at the home screen, and short sounds for the menus.
//
// Music: signed out, the stranger's theme (darker, the drums heavier); signed in, the theme of the clan whose
// side of the app is showing. A change crossfades. Browsers let a page make sound only after a tap or key, so
// nothing plays until the first one. Everything stops while the app is out of sight.
//
// Settings are kept on this device: the sound on or off as a whole, music and effects each on or off, and
// each one's volume.
import { useSyncExternalStore } from 'react';
import type { Clan } from './clan';

export type Track = Clan | 'stranger';
export type Sfx = 'hover' | 'select' | 'open' | 'back' | 'save' | 'denied' | 'praise' | 'respect' | 'switch';

export interface SoundSettings { muted: boolean; music: boolean; musicVolume: number; effects: boolean; effectsVolume: number }
const DEFAULTS: SoundSettings = { muted: false, music: true, musicVolume: 0.55, effects: true, effectsVolume: 0.75 };
const KEY = 'bt-sound';

/** Each theme's exact length. The mp3 files carry a few milliseconds of encoder padding beyond it. */
const LOOP: Record<Track, number> = { black_tusks: 43.636, scorned: 43.636, stranger: 48.0 };
/** Where LAME puts its encoder delay, for a browser whose decoder leaves it in (1105 samples). */
const LAME_DELAY = 1105;
const FADE = 2.2;

// ── settings
function read(): SoundSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s || typeof s !== 'object') return DEFAULTS;
    const vol = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
    return { muted: !!s.muted, music: s.music !== false, musicVolume: vol(s.musicVolume, DEFAULTS.musicVolume), effects: s.effects !== false, effectsVolume: vol(s.effectsVolume, DEFAULTS.effectsVolume) };
  } catch { return DEFAULTS; }
}
let settings = read();
const subs = new Set<() => void>();
export function setSound(patch: Partial<SoundSettings>) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: kept for this visit */ }
  subs.forEach((f) => f());
  applyVolumes(); void updateMusic();
}
export const getSound = () => settings;
export const useSound = (): SoundSettings => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => settings, () => settings);

// ── the audio engine
let ctx: AudioContext | null = null;
let musicBus: GainNode | null = null, fxBus: GainNode | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const ready = new Map<string, AudioBuffer>();

/** A sound remade after its first release gets a new address, so a copy a phone has kept is never played again. */
const REV: Record<string, number> = { ui_hover: 2, ui_select: 2, ui_back: 2, ui_open: 2, ui_save: 2, ui_denied: 2 };

function load(name: string): Promise<AudioBuffer | null> {
  if (!ctx) return Promise.resolve(null);
  let p = buffers.get(name);
  if (!p) {
    const c = ctx;
    p = fetch(`./sounds/${name}.mp3${REV[name] ? `?v=${REV[name]}` : ''}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      // the callback form, for older Safari
      .then((data) => new Promise<AudioBuffer>((ok, bad) => c.decodeAudioData(data, ok, bad)))
      .then((b) => { ready.set(name, b); return b; })
      .catch(() => { buffers.delete(name); return null; });
    buffers.set(name, p);
  }
  return p;
}

/** Each volume glides to where the settings put it, from wherever it is now. Anchored to the clock as it reads at
 *  this moment, so a level set while the sound was still asleep is set again, properly, once it wakes. */
function applyVolumes() {
  if (!ctx || !musicBus || !fxBus) return;
  const now = ctx.currentTime;
  const glide = (g: AudioParam, to: number, tc: number) => { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.setTargetAtTime(to, now, tc); };
  glide(musicBus.gain, settings.muted || !settings.music ? 0 : settings.musicVolume * 0.9, 0.15);
  glide(fxBus.gain, settings.muted || !settings.effects ? 0 : settings.effectsVolume, 0.05);
}

// Whether the browser lets the app make sound yet (the first tap). Until then the sound button says to tap.
let awake = false, awakeAt = -1e9;
const awakeSubs = new Set<() => void>();
function setAwake(v: boolean) { if (awake !== v) { awake = v; if (v) awakeAt = performance.now(); awakeSubs.forEach((f) => f()); } }
/** The sound woke with the tap that is happening now (the press wakes it, the click lands just after). */
export const wokeJustNow = () => performance.now() - awakeAt < 900;
export const useSoundAwake = (): boolean => useSyncExternalStore((f) => { awakeSubs.add(f); return () => { awakeSubs.delete(f); }; }, () => awake, () => false);

/** The sound has woken (or woken again): levels set afresh and the right theme started. */
function woke() {
  if (!ctx || ctx.state !== 'running') return;
  setAwake(true); applyVolumes(); void updateMusic();
}

const UI: Sfx[] = ['hover', 'select', 'open', 'back', 'save', 'denied', 'praise', 'respect', 'switch'];
let primed = false;
/** Called on every tap or key. Browsers allow sound only from inside one, so the sound is made, woken and
 *  (on iPhones) started from right here; a later tap tries again if the first did not take. */
function unlock(e: Event) {
  // a finger counts as a tap when it lifts, not when it lands; a mouse counts when pressed
  if (e.type === 'pointerdown' && (e as PointerEvent).pointerType !== 'mouse') return;
  if (document.hidden) return;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
    musicBus = ctx.createGain(); fxBus = ctx.createGain();
    musicBus.gain.value = 0; fxBus.gain.value = 0;
    musicBus.connect(ctx.destination); fxBus.connect(ctx.destination);
    ctx.addEventListener('statechange', () => { if (ctx?.state === 'running') woke(); else setAwake(false); });
    UI.forEach((s) => { void load('ui_' + s); });
  }
  // iPhones stay silent, even while saying the sound is running, until a sound has been started inside a tap:
  // one silent sample does it.
  if (!primed || ctx.state !== 'running') {
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); s.connect(ctx.destination); s.start(0); primed = true; } catch { /* tried */ }
  }
  if (ctx.state !== 'running') void ctx.resume().then(woke, () => undefined);
  else if (!awake || !playing) woke();
}
if (typeof window !== 'undefined') {
  const opts = { capture: true, passive: true } as const;
  for (const e of ['pointerdown', 'mousedown', 'pointerup', 'touchend', 'keydown', 'click'] as const) window.addEventListener(e, unlock, opts);
  // out of sight, out of hearing: phones keep pages alive in the background
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume().then(woke, () => undefined);
  });
}

/** A short sound. Silent before the first tap, or when effects are off. */
export function sfx(name: Sfx) {
  if (!ctx || !fxBus || settings.muted || !settings.effects) return;
  if (ctx.state !== 'running') { if (!document.hidden) void ctx.resume(); }
  const play = (b: AudioBuffer) => {
    const src = ctx!.createBufferSource(); src.buffer = b; src.connect(fxBus!); src.start();
  };
  const b = ready.get('ui_' + name);
  if (b) { play(b); return; }
  // not fetched yet: play it if it arrives at once, otherwise let the moment pass
  const asked = performance.now();
  void load('ui_' + name).then((buf) => { if (buf && performance.now() - asked < 350) play(buf); });
}

// ── music
let wanted: Track | null = null;
let playing: { track: Track; src: AudioBufferSourceNode; gain: GainNode } | null = null;
let starting: Track | null = null;

/** Which theme should be playing (null: none). The music follows when sound allows. */
export function setMusic(track: Track | null) {
  if (wanted === track) return;
  wanted = track;
  void updateMusic();
}

function fadeOut(p: NonNullable<typeof playing>, secs = FADE) {
  if (!ctx) return;
  const now = ctx.currentTime;
  p.gain.gain.cancelScheduledValues(now); p.gain.gain.setValueAtTime(p.gain.gain.value, now); p.gain.gain.linearRampToValueAtTime(0, now + secs);
  try { p.src.stop(now + secs + 0.05); } catch { /* already stopped */ }
}

async function updateMusic() {
  if (!ctx || !musicBus || ctx.state !== 'running') return;
  const want = settings.muted || !settings.music ? null : wanted;
  if (playing && playing.track === want) return;
  if (playing && playing.track !== want) { fadeOut(playing); playing = null; }
  if (!want || starting === want) return;
  starting = want;
  const buf = await load('theme_' + want);
  starting = null;
  // the wish may have changed while the theme was being fetched
  const now_want = settings.muted || !settings.music ? null : wanted;
  if (!buf || !ctx || !musicBus || now_want !== want || playing?.track === want) { if (now_want !== want) void updateMusic(); return; }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  // Loop over the music itself. A decoder that leaves the encoder's delay in gives a slightly longer buffer.
  const len = LOOP[want];
  const start = buf.duration - len > 0.02 ? LAME_DELAY / buf.sampleRate : 0;
  src.loopStart = start; src.loopEnd = Math.min(buf.duration, start + len);
  const gain = ctx.createGain(); gain.gain.value = 0;
  src.connect(gain); gain.connect(musicBus);
  const t = ctx.currentTime;
  gain.gain.linearRampToValueAtTime(1, t + FADE);
  src.start(t, start);
  playing = { track: want, src, gain };
}
