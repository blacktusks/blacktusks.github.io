export interface Ore { id: string; label: string; code: string; color: string; ink: string; item?: string }

// The nine ores Daedric Online's miners can work, plus sea salt deposits (the
// server's salt nodes use the same minigame). `item` is the ledger key of the ore.
export const ORES: Ore[] = [
  { id: 'iron', label: 'Iron', code: 'IR', color: '#b5583a', ink: '#fff', item: 'skyrim.esm:071CF3' },
  { id: 'corundum', label: 'Corundum', code: 'CO', color: '#c98f45', ink: '#1b1208', item: 'skyrim.esm:05ACDB' },
  { id: 'orichalcum', label: 'Orichalcum', code: 'OR', color: '#5c9a63', ink: '#fff', item: 'skyrim.esm:05ACDD' },
  { id: 'silver', label: 'Silver', code: 'SI', color: '#9fb0c4', ink: '#10151b', item: 'skyrim.esm:05ACDF' },
  { id: 'gold', label: 'Gold', code: 'GO', color: '#e6c044', ink: '#1b1404', item: 'skyrim.esm:05ACDE' },
  { id: 'quicksilver', label: 'Quicksilver', code: 'QS', color: '#dfe5ea', ink: '#141719', item: 'skyrim.esm:05ACE2' },
  { id: 'moonstone', label: 'Moonstone', code: 'MO', color: '#8fd0e6', ink: '#0b1a20', item: 'skyrim.esm:05ACE0' },
  { id: 'malachite', label: 'Malachite', code: 'MA', color: '#22b890', ink: '#04140f', item: 'skyrim.esm:05ACE1' },
  { id: 'ebony', label: 'Ebony', code: 'EB', color: '#3a3050', ink: '#e9dcff', item: 'skyrim.esm:05ACDC' },
  { id: 'salt', label: 'Sea Salt', code: 'SA', color: '#f3eee2', ink: '#262019', item: 'saltdeposits.esp:000801' },
];
export const ORE = Object.fromEntries(ORES.map((o) => [o.id, o]));
export const KINDS: [string, string][] = [['surface', 'Out in the open'], ['mine', 'Inside a mine'], ['cave', 'Inside a cave'], ['dungeon', 'Inside a dungeon or ruin']];
export const KIND = Object.fromEntries(KINDS);
