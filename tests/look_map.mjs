// The mining map zoomed out and dragged to a corner: node tests/look_map.mjs
import { boot } from './harness.mjs';
const t = await boot();
for (const [name, opts] of [['desktop', { viewport: { width: 1600, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const d = await t.open(opts);
  await t.signIn(d, 'nick');
  await d.goto(t.base + '#/map'); await d.waitForSelector('.leaflet-container'); await d.waitForTimeout(3000);
  await t.shot(d, `map-${name}-open`);
  const box = await d.locator('.map').boundingBox();
  if (name === 'desktop') {
    await d.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i++) { await d.mouse.wheel(0, 500); await d.waitForTimeout(200); }
    await d.waitForTimeout(1500);
    await d.mouse.down(); await d.mouse.move(box.x + box.width / 2 + 700, box.y + box.height / 2 + 500, { steps: 8 }); await d.mouse.up(); await d.waitForTimeout(1500);
    await t.shot(d, `map-${name}-out-dragged`);
  }
  const info = await d.evaluate(() => {
    const r = document.querySelector('.map').getBoundingClientRect();
    const pts = { top: [r.left + r.width / 2, r.top + 3], bottom: [r.left + r.width / 2, r.bottom - 3], left: [r.left + 3, r.top + r.height / 2], right: [r.right - 3, r.top + r.height / 2] };
    const out = { zoom: document.querySelector('.map').dataset.zoom, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    for (const [k, [x, y]] of Object.entries(pts)) out[k] = document.elementsFromPoint(x, y).slice(0, 4).map((e) => e.tagName + '.' + String(e.className).slice(0, 30));
    return out;
  });
  console.log(name, JSON.stringify(info));
  console.log(name, 'credit bar:', await d.evaluate(() => { const e = document.querySelector('.leaflet-control-attribution'); const c = getComputedStyle(e); return c.backgroundColor + ' / ' + c.color + ' / ' + e.textContent; }));
  await t.shot(d, `map-${name}-final`);
  await d.context().close();
}
console.log('errors:', t.errors);
await t.stop(); process.exit(0);
