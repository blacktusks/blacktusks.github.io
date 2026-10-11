// The ledger card with an item picture, desktop and phone: node tests/look_ledger.mjs
import { boot } from './harness.mjs';
const t = await boot();
for (const [name, opts, items] of [['desktop', { viewport: { width: 1500, height: 860 } }, ['Steel Armor', 'Daedric Warhammer', 'Grand Soul Gem']], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, ['Elven Boots']]]) {
  const page = await t.open(opts); await t.signIn(page, 'nick');
  await page.goto(t.base + '#/ledger'); await page.waitForSelector('.lrow');
  for (const item of items) {
    await page.getByLabel('Filter by name').fill(item); await page.waitForTimeout(500);
    await page.locator('.lrow', { hasText: item }).first().click();
    await page.waitForSelector('.icard__view img', { timeout: 8000 }).catch(() => console.log('no picture for', item));
    await page.waitForTimeout(900);
    console.log(name, item, JSON.stringify(await page.evaluate(() => { const i = document.querySelector('.icard__view img'); return i ? { src: i.getAttribute('src'), w: i.naturalWidth, shown: Math.round(i.getBoundingClientRect().width) } : null; })));
    await page.screenshot({ path: `tests/shots/ledger-${name}-${item.replace(/\W+/g, '-')}.png` });
    if (name === 'phone') await page.getByRole('button', { name: 'Back to list' }).click().catch(() => undefined);
  }
  await page.context().close();
}
await t.stop(); process.exit(0);
