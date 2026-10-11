/** What every member can see of another member. */
export interface Profile {
  id: string; display_name: string; tags: string[]; discord_name: string | null; created_at: string;
  /** The member's card: written by the member, readable by every member. */
  bio?: string; masteries?: { skill: string; level: number }[]; timezone?: string | null; availability?: number[] | null;
  /** For a member with the Deceased tag, written by officers. The date is a day, unknown, or not entered yet (null and not unknown). */
  death_honor?: string; death_cause?: string; death_date?: string | null; death_date_unknown?: boolean;
  /** Only present on your own profile and in the officers' list. */
  username?: string; must_change_password?: boolean;
}
export const PROFILE_COLUMNS = 'id, display_name, tags, discord_name, created_at, bio, masteries, timezone, availability, death_honor, death_cause, death_date, death_date_unknown';
/** An officer's own wording for a tag on the Roles screen. */
export interface RoleNote { tag: string; about: string; updated_at: string }
export type Visibility = 'all' | 'specific' | 'draft';
export interface Post {
  id: string; title: string; body: string; visibility: Visibility; audience: string[];
  expires_at?: string | null; author_id: string | null; updated_by: string | null; created_at: string; updated_at: string;
}
export interface ChangelogEntry { id: string; version: string; title: string; body: string; released_at: string }
export interface Stage { id: string; sort: number; title: string; details: string }
export interface Resource {
  id: string; stage_id: string; sort: number; name: string; unit: string; note: string;
  goal: number; have: number; in_total: boolean;
}
export type MarkerStatus = 'pending' | 'approved' | 'rejected';
export interface OreMarker {
  id: string; ore: string; x: number; y: number; kind: 'surface' | 'cave' | 'dungeon' | 'mine';
  place: string; note: string; veins: number; status: MarkerStatus; created_by: string | null; created_at: string; updated_at: string;
  reviewed_by: string | null; reviewed_at: string | null; review_note: string;
}
export interface LedgerEntry {
  item_key: string; tier: number | null; price: number | null; price_note: string; uses: string; acquire: string;
  image_path: string | null; hidden: boolean; custom: CustomItem | null; updated_by: string | null; updated_at: string;
}
export interface CustomItem { name: string; cat: string; type: string; value: number; weight: number }
