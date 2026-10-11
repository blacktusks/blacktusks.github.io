import { dataUrl } from '../config';
import type { LedgerEntry } from './types';

export type Cat = 'weapons' | 'apparel' | 'potions' | 'scrolls' | 'food' | 'ingredients' | 'books' | 'misc';
const CATS: Cat[] = ['weapons', 'apparel', 'potions', 'scrolls', 'food', 'ingredients', 'books', 'misc'];
export interface Item {
  key: string; name: string; cat: Cat; type: string; cls: string; value: number; weight: number;
  stat: number | null; src: string; generic: boolean; enchanted: boolean; custom?: boolean; lower: string;
  /** Name of the item's picture in /items, rendered from its game model. Absent when there is none. */
  pic?: string;
}
export interface Recipe { b: string; n: number; i: [string, number][]; r?: string; x?: 1 }
export interface Detail {
  d?: string; fx?: string[]; en?: string; mk?: Recipe[]; mkn?: number; tp?: { b: string; i: [string, number][] };
  bd?: [string, number][]; us?: string[]; usn?: number; hv?: string[];
}

let itemsPromise: Promise<Item[]> | null = null;
export function loadItems(): Promise<Item[]> {
  itemsPromise ??= fetch(dataUrl('items.json')).then((r) => r.json()).then((d: { sources: string[]; pics?: string[]; items: any[][] }) =>
    d.items.map(([key, name, cat, type, cls, value, weight, stat, src, flags, pic]) => ({
      key, name, cat, type, cls, value, weight, stat, src: d.sources[src], generic: !!(flags & 1), enchanted: !!(flags & 2), lower: name.toLowerCase(),
      pic: pic != null && pic >= 0 ? d.pics?.[pic] : undefined,
    })));
  return itemsPromise;
}
/** Address of an item's rendered picture. */
export const itemPictureUrl = (pic: string) => `./items/${pic}.webp`;

let detailsPromise: Promise<Record<string, Detail>> | null = null;
export function loadDetails(): Promise<Record<string, Detail>> {
  detailsPromise ??= fetch(dataUrl('details.json')).then((r) => r.json());
  return detailsPromise;
}

export function customItems(entries: LedgerEntry[]): Item[] {
  return entries.filter((e) => e.custom && typeof e.custom.name === 'string' && e.custom.name).map((e) => {
    const c = e.custom!; const name = String(c.name);
    return {
      key: e.item_key, name, cat: (CATS.includes(c.cat as Cat) ? c.cat : 'misc') as Cat, type: String(c.type || 'Misc'), cls: '', value: Number(c.value) || 0,
      weight: Number(c.weight) || 0, stat: null, src: 'Added by the clan', generic: false, enchanted: false, custom: true, lower: name.toLowerCase(),
    };
  });
}

const list = (xs: string[], max: number, total = xs.length) =>
  xs.slice(0, max).join(', ') + (total > max ? ` and ${total - max} more` : '');
const parts = (i: [string, number][]) => i.map(([n, q]) => `${q} ${n}`).join(', ');

/** What the item is for, worked out from the game files. Officers can overwrite it. */
export function autoUses(item: Item, d: Detail | undefined): string {
  const out: string[] = [];
  const t = item.type.toLowerCase();
  if (item.cat === 'weapons') out.push(t === 'arrow' ? 'Ammunition for bows.' : t === 'bolt' ? 'Ammunition for crossbows.' : `A ${item.cls ? item.cls.toLowerCase() + ' ' : ''}${t} for fighting.`);
  else if (item.cat === 'apparel') {
    out.push(item.cls === 'Jewelry' ? `Jewelry (${t}).` : item.cls === 'Clothing' ? `Clothing worn on the ${t === 'body' ? 'body' : t}.` : `${item.cls} armor: ${t}.`);
  } else if (item.cat === 'ingredients') out.push('Alchemy ingredient.' + (d?.fx?.length ? ` Effects: ${d.fx.join(', ')}.` : ''));
  else if (item.cat === 'books') out.push(item.type === 'Spell Tome' ? 'Teaches a spell when read.' : item.type === 'Skill Book' ? 'Raises a skill when read.' : 'Reading.');
  else if (item.type === 'Ore') out.push('Smelted into ingots.');
  else if (item.type === 'Fuel') out.push('Fuel for the smelter.');
  else if (item.type === 'Soul Gem') out.push('Holds a soul for enchanting.');
  if (item.cat !== 'ingredients' && d?.fx?.length) out.push(d.fx.join(' '));
  if (d?.d) out.push(d.d);
  if (d?.en) out.push(`Enchantment: ${d.en}.`);
  if (d?.us?.length) out.push(`Used to make ${list(d.us, 8, d.usn)}.`);
  if (d?.bd?.length) out.push(`Smelts down into ${d.bd.map(([n, q]) => `${q} ${n}`).join(' or ')}.`);
  return out.join(' ');
}

/** How the item is come by, worked out from the server's recipes. Officers can overwrite it. */
export function autoAcquire(item: Item, d: Detail | undefined): { made: boolean; text: string } {
  const out: string[] = [];
  const open = d?.mk?.filter((r) => !r.x) ?? [];
  for (const r of open.slice(0, 2)) {
    out.push(`Made at a ${r.b.toLowerCase()} from ${parts(r.i)}${r.n > 1 ? ` (makes ${r.n})` : ''}.${r.r ? ` Needs ${r.r}.` : ''}`);
  }
  if (open.length > 2 || (d?.mkn ?? 0) > 4) out.push('Other recipes exist.');
  if (!open.length && d?.mk?.some((r) => r.x)) out.push('Restricted design on Daedric Online: it cannot be crafted.');
  if (d?.hv?.length) out.push(`Harvested from ${list(d.hv, 4)}.`);
  if (item.type === 'Ore') out.push('Mined from ore veins. See the Mining Map.');
  if (d?.tp) out.push(`Improved at a ${d.tp.b.toLowerCase()} with ${parts(d.tp.i)}.`);
  if (!open.length && !d?.hv?.length && item.type !== 'Ore') out.unshift('Found: looted, bought or traded for. Not craftable.');
  return { made: open.length > 0, text: out.join(' ') };
}
