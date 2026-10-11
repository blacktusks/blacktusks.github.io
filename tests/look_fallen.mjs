// Pictures of the 0.2.5 screens for looking over: Deceased, a fallen card and its form, Roles, the folding change log.
//   node tests/look_fallen.mjs
import { boot } from './harness.mjs';
const t = await boot();
await t.backend.seedUser('durak', 'Durak Iron-Jaw', ['blooded', 'deceased']);
await t.backend.seedUser('borba', 'Borba the Elder', ['wise_woman', 'deceased']);
for (const [name, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const page = await t.open(opts); await t.signIn(page, 'nick');
  const go = async (r, wait = 900) => { await page.goto(t.base + '#' + r); await page.waitForTimeout(wait); };
  await go('/deceased'); await page.waitForSelector('.roster__row');
  await page.getByText('Durak Iron-Jaw').click(); await page.waitForSelector('.modal');
  await t.shot(page, `fallen-${name}-card-empty`);
  await page.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click(); await page.waitForTimeout(300);
  await page.getByLabel('Passage of honor').fill('Durak stood where others ran. He asked for no song and no stone, only that the gate hold.\nThe fire of Largashbur remembers him.');
  await page.getByLabel('Cause of death').fill('Fell holding the gate of Largashbur against a giant, so the others could bar it behind him.');
  await page.getByLabel('Date of passing').fill('2026-10-03');
  await t.shot(page, `fallen-${name}-form`);
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForSelector('.modal .note');
  await t.shot(page, `fallen-${name}-card`);
  await page.getByRole('button', { name: 'Pay Respect' }).click(); await page.waitForTimeout(420);
  await t.shot(page, `fallen-${name}-respect`);
  await page.waitForTimeout(1300);
  await page.locator('.modal').getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(300);
  await t.shot(page, `fallen-${name}-list`);
  await go('/roles'); await page.waitForSelector('.roles__row'); await t.shot(page, `fallen-${name}-roles`);
  await page.getByRole('button', { name: 'Edit Wise Woman' }).click(); await page.waitForSelector('.modal'); await t.shot(page, `fallen-${name}-roles-edit`);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await go('/notices'); await page.getByRole('tab', { name: 'Change log' }).click(); await page.waitForTimeout(500);
  if (name === 'desktop') {
    await page.getByRole('button', { name: 'Add an entry' }).click(); await page.getByLabel('Version').fill('0.2.5'); await page.getByLabel('What changed').fill('The fire honors the FALLEN!');
    await page.getByLabel('Details').fill('Third beta build of the Black Tusk companion:\n• Profile added to the main menu\n• Deceased Menu added\n• Roles Menu added\n• Change log entries are now collapsible');
    await page.getByRole('button', { name: 'Save entry' }).click(); await page.waitForTimeout(600);
  }
  await t.shot(page, `fallen-${name}-log`);
  await go('/'); await page.getByRole('button', { name: 'Profile', exact: true }).click(); await page.waitForSelector('.modal'); await page.waitForTimeout(500);
  await t.shot(page, `fallen-${name}-profile`);
  await page.context().close();
}
console.log(t.errors.length ? t.errors.join('\n') : 'no page errors');
await t.stop(); process.exit(0);
