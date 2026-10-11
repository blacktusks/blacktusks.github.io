// The main menu before and after its big picture arrives: node tests/look_firstload.mjs
import { boot } from './harness.mjs';
const t = await boot();
for (const [name, opts] of [['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1600, height: 900 } }]]) {
  const ctx = await t.browser.newContext(opts);
  const page = await ctx.newPage();
  let release; const held = new Promise((r) => { release = r; });
  await page.route('**/img/largashbur.webp', async (route) => { await held; await route.continue(); });
  await page.goto(t.base);
  await page.waitForSelector('.menu__nav'); await page.waitForTimeout(2500);
  const before = await page.evaluate(() => ({ sharp: document.querySelector('.scene')?.classList.contains('is-sharp'), fire: getComputedStyle(document.querySelector('.scene__fireset')).opacity }));
  await page.screenshot({ path: `tests/shots/first-${name}-a-waiting.png` });
  release(); await page.waitForSelector('.scene.is-sharp'); await page.waitForTimeout(1600);
  const after = await page.evaluate(() => ({ sharp: document.querySelector('.scene')?.classList.contains('is-sharp'), fire: getComputedStyle(document.querySelector('.scene__fireset')).opacity }));
  await page.screenshot({ path: `tests/shots/first-${name}-b-arrived.png` });
  console.log(name, JSON.stringify(before), JSON.stringify(after));
  await ctx.close();
}
await t.stop(); process.exit(0);
