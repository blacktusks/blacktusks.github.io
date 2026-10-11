// The eighteen masteries a member can claim (three at most), each with a level from 0 to 5.
// The list is kept in two places: here, and in valid_masteries() in the database, which has the last word.
// The ids are what the database stores; changing a label here changes it everywhere.
export interface Mastery { skill: string; level: number }

/** Icons are drawn on a 24 by 24 grid as thin strokes, after the plain glyphs of the Skyrim menus. */
export interface Skill { id: string; label: string; lines: string[]; solid?: string[]; dots?: [number, number, number][] }

export const SKILLS: Skill[] = [
  { id: 'one_handed', label: 'One Handed',
    lines: ['M20.5 3.5 L18.6 9.4 L9.6 18.4 L5.6 14.4 L14.6 5.4 Z', 'M4.2 13 L11 19.8', 'M7.4 16.6 L4.6 19.4'], dots: [[3.8, 20.2, 1.1]] },
  { id: 'two_handed', label: 'Two Handed',
    lines: ['M12 2.5 V21.5', 'M12 7.5 L6 4.5 Q2.5 9.5 6 14.5 L12 11.5', 'M12 7.5 L18 4.5 Q21.5 9.5 18 14.5 L12 11.5', 'M10.4 21.5 H13.6'] },
  { id: 'dual_wielder', label: 'Dual Wielder',
    lines: ['M7 17 L20 4', 'M4 14.5 L9.5 20', 'M6.6 17.4 L4.2 19.8', 'M17 17 L4 4', 'M20 14.5 L14.5 20', 'M17.4 17.4 L19.8 19.8'] },
  { id: 'bow', label: 'Bow',
    lines: ['M8 2.5 C17.5 5.5 17.5 18.5 8 21.5', 'M8 2.5 L5 12 L8 21.5', 'M5 12 H21.5', 'M18.4 9.2 L21.5 12 L18.4 14.8'] },
  { id: 'armor', label: 'Armor',
    lines: ['M8 3.5 L5 5 L3.5 9 L6.5 10.5 V20.5 H17.5 V10.5 L20.5 9 L19 5 L16 3.5 C15 5.6 9 5.6 8 3.5 Z', 'M12 8.5 V20.5', 'M6.5 16 H17.5'] },
  { id: 'shield', label: 'Shield',
    lines: ['M12 3 L19.5 5.5 V11.5 C19.5 16 16.5 19.5 12 21.5 C7.5 19.5 4.5 16 4.5 11.5 V5.5 Z', 'M12 6.5 V8.6', 'M12 13.4 V18', 'M7.5 11 H9.6', 'M14.4 11 H16.5'],
    dots: [[12, 11, 2.2]] },
  { id: 'cook', label: 'Cook',
    lines: ['M3.5 9.5 H20.5', 'M5 9.5 V14 C5 17.4 8 19.5 12 19.5 C16 19.5 19 17.4 19 14 V9.5', 'M8 19 L7 21.5', 'M16 19 L17 21.5',
      'M9 7 C8.2 6 9.8 5 9 3.8', 'M12 7 C11.2 6 12.8 5 12 3.8', 'M15 7 C14.2 6 15.8 5 15 3.8'] },
  { id: 'alchemist', label: 'Alchemist',
    lines: ['M9.5 3 H14.5', 'M10.5 3 V8.5 L5.5 18 C4.8 19.6 5.8 21 7.5 21 H16.5 C18.2 21 19.2 19.6 18.5 18 L13.5 8.5 V3', 'M7.6 14.2 H16.4'],
    dots: [[10.6, 17.4, 0.9], [13.6, 16.6, 0.7]] },
  { id: 'blacksmith', label: 'Blacksmith',
    lines: ['M3 8.5 H16.5 V12.5 H13 V15.5 L15.5 18.5 V20.5 H6 V18.5 L8.5 15.5 V12.5 C6 12.5 4 11.2 3 8.5 Z', 'M16.5 8.5 H21.5 C20.6 10.6 18.8 11.6 16.5 11.6', 'M8 4 H13 V6.2 H8 Z', 'M13 5.1 H18'] },
  { id: 'woodcutter', label: 'Woodcutter',
    lines: ['M7 3 V21.5', 'M7 6.2 Q12 6.2 15.5 3.2 Q20.4 8.6 16.2 14.2 Q12.4 10.8 7 10.8', 'M14 17 H20.2 A1.6 2.25 0 0 1 20.2 21.5 H14 A1.6 2.25 0 0 1 14 17 A1.6 2.25 0 0 1 14 21.5'] },
  { id: 'tailor', label: 'Tailor',
    lines: ['M8.8 16.4 L16.5 3.5', 'M15.2 16.4 L7.5 3.5'], dots: [[7.2, 18.6, 2.6], [16.8, 18.6, 2.6]] },
  { id: 'scholar', label: 'Scholar',
    lines: ['M12 6.5 C10 5 7 4.5 3.5 5 V18.5 C7 18 10 18.5 12 20 C14 18.5 17 18 20.5 18.5 V5 C17 4.5 14 5 12 6.5 Z', 'M12 6.5 V20',
      'M6 9 H9.5', 'M6 12 H9.5', 'M14.5 9 H18', 'M14.5 12 H18'] },
  { id: 'miner', label: 'Miner',
    lines: ['M5 20.5 L15.6 7.4', 'M7.5 4.2 C12.4 2.8 18.6 4.8 20.4 12.8 C17.6 8.6 13.4 6.2 7.5 4.2 Z', 'M3.6 19.2 L6.4 21.8'] },
  { id: 'first_aid', label: 'First Aid',
    lines: ['M9.5 4 H14.5 V9.5 H20 V14.5 H14.5 V20 H9.5 V14.5 H4 V9.5 H9.5 Z'] },
  { id: 'lockpicking', label: 'Lockpicking',
    lines: ['M14 3.5 A4.3 4.3 0 0 1 16.5 11.4 L17.8 20.5 H10.2 L11.5 11.4 A4.3 4.3 0 0 1 14 3.5 Z', 'M2.5 9 H9.5 L10.6 7.6', 'M2.5 12.5 H8.5'] },
  { id: 'skinner', label: 'Skinner',
    lines: ['M9 3.5 H15 L15.5 6 L20.5 5 L19 9.5 L17 10.5 V14 L20 17.5 L16.5 19 L14.5 17 L12.8 20.8 H11.2 L9.5 17 L7.5 19 L4 17.5 L7 14 V10.5 L5 9.5 L3.5 5 L8.5 6 Z'] },
  { id: 'harvester', label: 'Harvester',
    lines: ['M9 14.6 C4.6 9.4 8 3.5 14.6 3.5 C18 3.5 20.6 5.6 21 8.2 C18.6 6.2 15.6 6 13.2 7.4 C10.8 8.8 10 11.8 11.4 13.4 Z', 'M10 14 L5.4 19.6', 'M3.9 18.3 L6.7 21'] },
  { id: 'artifact_scavenger', label: 'Artifact Scavenger',
    lines: ['M8 3.5 H16', 'M9 3.5 C9 6 6 7.5 6 11.5 C6 15 8.5 17.5 10.5 18 V20 H8 V21.5 H16 V20 H13.5 V18 C15.5 17.5 18 15 18 11.5 C18 7.5 15 6 15 3.5',
      'M6.4 10 H17.6', 'M6.3 9 C3.4 8.4 3.4 12.6 6.6 13', 'M17.7 9 C20.6 8.4 20.6 12.6 17.4 13'] },
];
export const SKILL: Record<string, Skill> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
export const MAX_MASTERIES = 3;
export const MAX_LEVEL = 5;
/** Keeps only what the database will accept, in case old or odd data arrives. */
export const cleanMasteries = (m: unknown): Mastery[] => (Array.isArray(m) ? m : [])
  .filter((x): x is Mastery => !!x && typeof x.skill === 'string' && !!SKILL[x.skill] && Number.isInteger(x.level) && x.level >= 0 && x.level <= MAX_LEVEL)
  .filter((x, i, all) => all.findIndex((y) => y.skill === x.skill) === i)
  .slice(0, MAX_MASTERIES);
