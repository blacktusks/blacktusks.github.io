// The two clans: both home screens, the fog switch between them, the signed-out turn, and the Scorned screens.
//   node tests/look_clans.mjs
import { boot } from './harness.mjs';
const t = await boot();
await t.backend.seedUser('zgor', 'Zgor', ['chieftain'], 'TestPass123', ['scorned']);
await t.backend.seedUser('morra', 'Morra', ['wise_woman'], 'TestPass123', ['scorned']);
await t.backend.seedUser('shum', 'Shum', ['blooded'], 'TestPass123', ['scorned']);
const settle = (p, ms = 3500) => p.waitForTimeout(ms);
const sizes = { phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { viewport: { width: 1600, height: 900 } } };

for (const [name, opts] of Object.entries(sizes)) {
  // a Black Tusk opens on the Black Tusks, visits the Scorned
  const p = await t.open(opts);
  await t.signIn(p, 'nick'); await settle(p);
  await t.shot(p, `clans-${name}-bt`);
  await p.getByRole('button', { name: 'Visit The Scorned' }).click();
  await p.waitForTimeout(450); await t.shot(p, `clans-${name}-fog-out`);
  await p.waitForTimeout(700); await t.shot(p, `clans-${name}-fog-in`);
  await settle(p, 4000); await t.shot(p, `clans-${name}-sc`);
  for (const [label, path] of [['Notice Board', 'notices'], ['Scorned Oath', 'oath'], ['Mine of the Scorned', 'mine'], ['Expansion Goals', 'expansion'], ['Deceased', 'deceased']]) {
    await p.getByRole('button', { name: label, exact: true }).click(); await p.waitForTimeout(1500);
    await t.shot(p, `clans-${name}-sc-${path}`);
    await p.getByRole('link', { name: 'Back' }).click(); await p.waitForSelector('.menu__nav'); await p.waitForTimeout(500);
  }
  await p.getByRole('button', { name: 'Members', exact: true }).click(); await p.waitForTimeout(1500);
  await t.shot(p, `clans-${name}-members`);
  await p.getByRole('tab', { name: 'Scorned Only' }).click(); await p.waitForTimeout(400);
  await t.shot(p, `clans-${name}-members-scorned`);
  await p.locator('.roster__row', { hasText: 'Zgor' }).click(); await p.waitForTimeout(500);
  await t.shot(p, `clans-${name}-card`);
  await p.getByRole('button', { name: 'Edit' }).click(); await p.waitForTimeout(400);
  await p.locator('.modal').evaluate((m) => { const b = m.querySelector('.modal__body') ?? m; b.scrollTop = b.scrollHeight; });
  await t.shot(p, `clans-${name}-card-edit`);
  await p.close();

  // a Scorned member opens on the Scorned
  const s = await t.open(opts);
  await t.signIn(s, 'zgor'); await settle(s);
  await t.shot(s, `clans-${name}-scorned-home`);
  await s.close();

  // signed out: the Black Tusks, then the Scorned
  const g = await t.open(opts); await settle(g, 3000);
  await t.shot(g, `clans-${name}-guest-a`);
  await g.waitForTimeout(8200); await t.shot(g, `clans-${name}-guest-b`);
  await g.close();
}
console.log(t.errors.length ? t.errors.join('\n') : 'no page errors');
await t.stop();
