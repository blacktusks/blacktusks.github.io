// The loading screen while the app behind it is still arriving: node tests/look_splash.mjs
import { boot } from './harness.mjs';
const t = await boot();
for (const [name, opts] of [['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['wide', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1600, height: 900 } }]]) {
  const ctx = await t.browser.newContext(opts);
  const page = await ctx.newPage();
  let release; const held = new Promise((r) => { release = r; });
  await page.route('**/img/largashbur.webp', async (route) => { await held; await route.continue(); });
  await page.goto(t.base, { waitUntil: 'commit' });
  await page.waitForSelector('.menu__nav', { state: 'attached' }); await page.waitForTimeout(1500);
  const during = await page.evaluate(() => ({ splash: !!document.getElementById('splash'), bar: getComputedStyle(document.getElementById('splash')).getPropertyValue('--p') }));
  await page.screenshot({ path: `tests/shots/splash-${name}.png` });
  release();
  const t0 = Date.now(); await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 20000 });
  console.log(name, JSON.stringify(during), 'lifted', Date.now() - t0, 'ms after the last picture arrived');
  await ctx.close();
}
await t.stop(); process.exit(0);
