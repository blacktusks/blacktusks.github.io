// Pictures of the Code of Mauloch shrine for looking over: at rest, with a burst, and with words up.
//   node tests/look_shrine.mjs
import { boot } from './harness.mjs';
const t = await boot();
for (const [name, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['small', { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const page = await t.open(opts);
  await page.goto(t.base + '#/code'); await page.waitForSelector('.shrine__statue'); await page.waitForFunction(() => document.querySelector('.shrine__statue').complete);
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 20000 }).catch(() => undefined); await page.waitForTimeout(900);
  await t.shot(page, `shrine-${name}`);
  await page.getByRole('button', { name: 'Praise Malacath' }).click(); await page.waitForTimeout(450);
  await t.shot(page, `shrine-${name}-burst`);
  await page.waitForTimeout(2600);
  await t.shot(page, `shrine-${name}-words`);
  await page.context().close();
}
console.log(t.errors.length ? t.errors.join('\n') : 'no page errors');
await t.stop(); process.exit(0);
