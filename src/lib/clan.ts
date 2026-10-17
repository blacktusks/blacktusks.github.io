import { useEffect, useSyncExternalStore } from 'react';

/**
 * Two clans share the app: the Black Tusks of Largashbur and the Scorned of Narzulbur. Every member
 * carries one or both clan tags, kept apart from the role tags. A role counts within its own clan:
 * the Scorned Chieftain is a member with the Chieftain tag and the Scorned clan tag. The Forgemaster
 * counts in every clan.
 */
export type Clan = 'black_tusks' | 'scorned';
export const CLANS: Clan[] = ['black_tusks', 'scorned'];

export interface ClanInfo {
  id: Clan;
  /** The clan tag, as it reads on a member. */
  tag: string;
  /** The name at the top of the clan's home screen. */
  title: string;
  /** "Black Tusk", "Scorned": as in "Black Tusk Oath". */
  adj: string;
  stronghold: string;
  mine: string;
  /** Where the clan's own screens live: /notices for the Black Tusks, /scorned/notices for the Scorned. */
  base: string;
}
export const CLAN: Record<Clan, ClanInfo> = {
  black_tusks: { id: 'black_tusks', tag: 'The Black Tusks Clan', title: 'The Black Tusks', adj: 'Black Tusk', stronghold: 'Largashbur', mine: 'Mine of the Black Tusks', base: '' },
  scorned: { id: 'scorned', tag: 'The Scorned Clan', title: 'The Scorned', adj: 'Scorned', stronghold: 'Narzulbur', mine: 'Mine of the Scorned', base: '/scorned' },
};
export const otherClan = (c: Clan): Clan => (c === 'black_tusks' ? 'scorned' : 'black_tusks');
export const isClan = (c: unknown): c is Clan => c === 'black_tusks' || c === 'scorned';
/** A clan's own screen: clanPath('scorned', '/mine') is /scorned/mine. */
export const clanPath = (c: Clan, path: string) => CLAN[c].base + path;

/** Clan tags in a fixed order, unknown ones dropped. */
export const sortClans = (clans?: string[] | null): Clan[] => CLANS.filter((c) => clans?.includes(c));
/** Where a member's home screen is: the Black Tusks for a Black Tusk (or someone in both clans), else the Scorned. */
export const homeClan = (clans?: string[] | null): Clan => (!clans?.length || clans.includes('black_tusks') ? 'black_tusks' : 'scorned');

type Who = { tags?: string[]; clans?: string[] | null } | null | undefined;
const has = (who: Who, ...tags: string[]) => !!who?.tags && tags.some((t) => who.tags!.includes(t));
const smith = (who: Who) => has(who, 'forgemaster');
const inClan = (who: Who, c: Clan) => !!who?.clans?.includes(c);

/** The clan's Chieftain, Right Tusk, Left Tusk and Wise Woman, and the Forgemaster. */
export const isClanOfficer = (who: Who, c: Clan) => smith(who) || (inClan(who, c) && has(who, 'chieftain', 'right_tusk', 'left_tusk', 'wise_woman'));
/** Who keeps a clan's mine and its Expansion Goals: that clan's officers, and the Forgemaster. */
export const canKeepMine = (who: Who, c: Clan) => isClanOfficer(who, c);
export const canKeepGoals = (who: Who, c: Clan) => isClanOfficer(who, c);
/** Who may remove a member: a Chieftain of one of their clans, or the Forgemaster. Never the Forgemaster, never yourself. */
export const canRemove = (me: Who & { id?: string }, them: Who & { id?: string }) =>
  !!me && !!them && me.id !== them.id && !has(them, 'forgemaster') && (smith(me) || (has(me, 'chieftain') && sharesClan(me, them)));
/** Whose account an officer may manage: members of their own clan (or of none yet). The Forgemaster manages everyone. */
export const sharesClan = (me: Who, them: Who) => smith(me) || !them?.clans?.length || !!them.clans.some((c) => me?.clans?.includes(c));

// ── which clan's side of the app is showing
// Kept for the browser session, so the inner screens and the way back keep to the side the member chose.
const KEY = 'bt-side';
type Saved = { uid: string; side: Clan };
function load(): Saved | null {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return s && isClan(s.side) ? s : null; } catch { return null; }
}
let saved: Saved | null = load();
let side: Clan = saved?.side ?? 'black_tusks';
const subs = new Set<() => void>();
function put(next: Clan, uid = saved?.uid ?? '') {
  saved = { uid, side: next };
  try { sessionStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode: the side is kept in memory only */ }
  if (next !== side) { side = next; subs.forEach((f) => f()); }
}
/** Show this clan's side of the app. */
export const setSide = (c: Clan) => put(c);
/** On signing in, a member starts on their own clan's side, unless they already moved this session. */
export function startSide(uid: string, clans?: string[] | null) {
  if (saved?.uid === uid) return;
  put(homeClan(clans), uid);
}
export const currentSide = () => side;
export const useSide = (): Clan => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => side, () => side);

/** A clan's own screen puts the app on that clan's side, so Back and the inner screens keep to it. */
export function useClanScreen(c: Clan) {
  useEffect(() => { setSide(c); }, [c]);
}
