export type Tag =
  | 'chieftain' | 'right_tusk' | 'left_tusk' | 'wise_woman' | 'blooded' | 'blood_kin'
  | 'kinsmen' | 'unblooded' | 'ally' | 'daedric' | 'forgemaster' | 'deceased';

export interface TagInfo { id: Tag; label: string; color: string; about: string }

// Listed in standing order: this is the order members are sorted by.
export const TAGS: TagInfo[] = [
  { id: 'chieftain', label: 'Chieftain', color: '#e2b23c', about: 'Leads the clan.' },
  { id: 'right_tusk', label: 'Right Tusk', color: '#e0522c', about: 'General. Answers only to the Chieftain.' },
  { id: 'left_tusk', label: 'Left Tusk', color: '#d9792f', about: 'Second general.' },
  { id: 'wise_woman', label: 'Wise Woman', color: '#a98be0', about: 'Keeper of the Code and the clan’s counsel.' },
  { id: 'forgemaster', label: 'Forgemaster', color: '#7fb2c9', about: 'Builds and keeps this companion.' },
  { id: 'blooded', label: 'Blooded', color: '#c8372d', about: 'Sworn and proven.' },
  { id: 'blood_kin', label: 'Blood-Kin', color: '#b0625a', about: 'Sworn to the clan.' },
  { id: 'kinsmen', label: 'Kinsmen', color: '#cdbb93', about: 'Of the clan.' },
  { id: 'unblooded', label: 'Un-Blooded', color: '#9a9488', about: 'Not yet proven.' },
  { id: 'ally', label: 'Ally', color: '#6fae9a', about: 'A trusted friend of the clan.' },
  { id: 'daedric', label: 'Daedric', color: '#c05fd0', about: 'A Daedric Online game master.' },
  { id: 'deceased', label: 'Deceased', color: '#8a8f98', about: 'Their character has fallen. They keep their place by the fire.' },
];
export const TAG = Object.fromEntries(TAGS.map((t) => [t.id, t])) as Record<Tag, TagInfo>;
const ORDER = Object.fromEntries(TAGS.map((t, i) => [t.id, i])) as Record<Tag, number>;

const OFFICER: Tag[] = ['chieftain', 'right_tusk', 'left_tusk', 'wise_woman', 'forgemaster'];
const any = (tags: string[] | undefined, wanted: Tag[]) => !!tags && wanted.some((t) => tags.includes(t));

/** Chieftain, Right Tusk, Left Tusk, Wise Woman, Forgemaster: members, mine deals, expansion goals. */
export const isOfficer = (tags?: string[]) => any(tags, OFFICER);
/** Officers plus Daedric: notices, map approvals, pricing ledger. */
export const isHerald = (tags?: string[]) => any(tags, [...OFFICER, 'daedric']);
export const isForgemaster = (tags?: string[]) => any(tags, ['forgemaster']);

export const sortTags = (tags: string[]) => [...tags].sort((a, b) => (ORDER[a as Tag] ?? 99) - (ORDER[b as Tag] ?? 99));
/** Lower is higher standing. Deceased members sort last. */
export function standing(tags: string[]): number {
  if (tags.includes('deceased')) return 90;
  const ranks = tags.map((t) => ORDER[t as Tag] ?? 99);
  return ranks.length ? Math.min(...ranks) : 80;
}
