// Screenshots of the mining map at two zoom levels: node tests/look_map.mjs
import { boot } from './harness.mjs';
const t = await boot();
const d = await t.open({ viewport: { width: 1600, height: 900 } });
await t.signIn(d, 'nick');
await d.goto(t.base + '#/map'); await d.waitForSelector('.leaflet-container'); await d.waitForTimeout(3000);
await t.shot(d, 'map-default');
await d.mouse.move(700, 450); for (let i = 0; i < 6; i++) { await d.mouse.wheel(0, 400); await d.waitForTimeout(350); }
await d.waitForTimeout(2000);
await t.shot(d, 'map-far');
const labels = await d.locator('.place--city span').allTextContents();
console.log('city labels:', labels.join(', '));
console.log('filter text:', (await d.locator('.mapkey').textContent()).replace(/\s+/g, ' ').slice(0, 300));
console.log('errors:', t.errors);
await t.stop(); process.exit(0);
