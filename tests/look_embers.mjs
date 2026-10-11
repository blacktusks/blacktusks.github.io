// The home screen with its drifting embers, the oath with the shining name, and the ledger card's pager on a phone.
//   node tests/look_embers.mjs
import { boot } from './harness.mjs';
const t = await boot();
for (const [name, opts] of [['desktop', { viewport: { width: 1440, height: 810 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const page = await t.open(opts); await t.signIn(page, 'nick');
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 20000 });
  await page.waitForTimeout(11000);
  await page.screenshot({ path: `tests/shots/embers-${name}.png` });
  await page.goto(t.base + '#/oath'); await page.waitForSelector('.oath__name'); await page.waitForTimeout(2900);
  await page.screenshot({ path: `tests/shots/oath-${name}.png` });
  console.log(name, 'oath name', JSON.stringify(await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.oath__name')); return { weight: cs.fontWeight, anim: cs.animationName, clip: cs.webkitBackgroundClip || cs.backgroundClip, border: cs.borderBottomStyle }; })));
  await page.context().close();
}
console.log(t.errors.length ? t.errors : 'no page errors');
await t.stop(); process.exit(0);
