// A member's usual hours: seven numbers, Monday to Sunday. In each, bit h is
// set when they are usually free from hour h to h+1, in their own time zone.
export type Week = number[];
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const emptyWeek = (): Week => [0, 0, 0, 0, 0, 0, 0];
export const cleanWeek = (w: unknown): Week => (Array.isArray(w) && w.length === 7 ? w.map((n) => (Number.isInteger(n) ? n & 0xffffff : 0)) : emptyWeek());
export const isFree = (w: Week, day: number, hour: number) => ((w[day] >> hour) & 1) === 1;
export const setFree = (w: Week, day: number, hour: number, on: boolean): Week =>
  w.map((bits, d) => (d !== day ? bits : on ? bits | (1 << hour) : bits & ~(1 << hour)));
export const hoursFree = (w: Week) => w.reduce((n, bits) => n + bits.toString(2).split('1').length - 1, 0);

export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;

export const deviceZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
export function allZones(): string[] {
  try { const z = (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined; if (z?.length) return z; } catch { /* older browser */ }
  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Sao_Paulo',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Helsinki', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Shanghai',
    'Asia/Tokyo', 'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland'];
}
/** Minutes ahead of UTC right now in a zone (daylight saving included). Unknown zones count as UTC. */
export function zoneOffset(zone: string, at = new Date()): number {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch { return 0; }
}
export function zoneName(zone: string): string {
  const m = zoneOffset(zone), sign = m < 0 ? '-' : '+', a = Math.abs(m);
  return `${zone.replace(/_/g, ' ')} (UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''})`;
}
/** The same hours seen from another zone. Half-hour zones round to the nearest hour. */
export function shiftWeek(w: Week, fromZone: string, toZone: string): Week {
  const by = Math.round((zoneOffset(toZone) - zoneOffset(fromZone)) / 60);
  if (!by) return w;
  const out = emptyWeek();
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    if (!isFree(w, d, h)) continue;
    const t = (((d * 24 + h + by) % 168) + 168) % 168;
    out[Math.floor(t / 24)] |= 1 << (t % 24);
  }
  return out;
}
const span = (from: number, to: number) => { let b = 0; for (let h = from; h < to; h++) b |= 1 << h; return b; };
export const PRESETS: [string, Week][] = [
  ['Weekday evenings', [span(18, 23), span(18, 23), span(18, 23), span(18, 23), span(18, 24), 0, 0]],
  ['Weekends', [0, 0, 0, 0, 0, span(10, 24), span(10, 22)]],
];
export const mergeWeek = (a: Week, b: Week): Week => a.map((bits, d) => bits | b[d]);
