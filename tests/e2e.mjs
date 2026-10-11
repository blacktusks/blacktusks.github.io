// End-to-end checks in a real browser against the local backend.
import sharp from 'sharp';
import { boot } from './harness.mjs';

const t = await boot();
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : (fail++, console.log('  FAIL', name, extra)); };
const go = async (page, route, wait = 700) => { const to = t.base + '#' + route; if (page.url() === to) await page.reload(); else await page.goto(to); await page.waitForTimeout(wait); };
const menu = (page) => page.locator('.menu__item').allTextContents();
const has = async (page, role, name) => (await page.getByRole(role, { name, exact: true }).count()) > 0;
const user = async (name, password, opts) => { const p = await t.open(opts); await t.signIn(p, name, password); return p; };

console.log('guest');
const g = await t.open();
await g.waitForSelector('.menu__nav');
ok((await menu(g)).join('|') === 'Sign In|Code of Mauloch', 'guest menu is Sign In and Code of Mauloch', (await menu(g)).join('|'));
await g.getByRole('button', { name: 'Code of Mauloch' }).click();
ok((await g.locator('.tenet').count()) === 7, 'Code of Mauloch shows seven tenets');
ok((await g.locator('.tenet__name').allTextContents())[6] === 'Let Every Clan Keep Its Fire Without Treachery', 'seventh tenet title matches');
ok((await g.textContent('.scroll')).includes('Treachery poisons every Orcish fire.'), 'closing line present');
await go(g, '/members'); ok(g.url().endsWith('#/sign-in'), 'guests are sent to sign in from member screens');
await g.getByLabel('Name').fill('nick'); await g.getByLabel('Password').fill('wrong-password'); await g.getByRole('button', { name: 'Sign in' }).click();
await g.waitForSelector('.error'); ok((await g.textContent('.error')).includes('do not match'), 'wrong password is refused with a clear message');
await g.context().close();

console.log('member menu');
const nick = await user('nick');
ok((await menu(nick)).join('|') === 'Sign Out|Code of Mauloch|Notice Board|Black Tusk Oath|Members|Mine of the Black Tusks|Expansion Goals|Mining Map|Pricing Ledger', 'member menu has the nine options in the brief\'s order', (await menu(nick)).join('|'));
ok(await nick.locator('canvas.banner').count() === 1 && await nick.locator('.scene__fire').count() === 1, 'banner and fire canvases are on the main menu');
await nick.waitForSelector('canvas.banner.is-ready', { timeout: 15000 });
{ // the banner really animates: two frames differ
  const grab = () => nick.locator('canvas.banner').screenshot();
  const a = await grab(); await nick.waitForTimeout(700); const b = await grab();
  ok(!a.equals(b), 'the banner cloth moves between frames');
  const f1 = await nick.locator('.scene__fire').screenshot(); await nick.waitForTimeout(300); const f2 = await nick.locator('.scene__fire').screenshot();
  ok(!f1.equals(f2), 'the fire moves between frames');
}
await go(nick, '/oath'); ok((await nick.textContent('.oath')).includes('I Nick give my life to the Black Tusk'), 'the oath carries the member\'s name');

console.log('members');
await go(nick, '/members', 1000);
ok((await nick.locator('.roster__row').count()) === 6, 'all six members listed');
await nick.getByRole('button', { name: 'Add member' }).click();
await nick.getByLabel('Sign-in name').fill('Durak'); await nick.getByLabel('Display name').fill('Durak Iron-Jaw');
await nick.getByRole('button', { name: 'Blood-Kin' }).click();
await nick.locator('.modal').getByRole('button', { name: 'Add member' }).click();
await nick.waitForSelector('.secret__value');
const temp = (await nick.locator('.secret__value').allTextContents())[1];
ok(temp && temp.length >= 12, 'a temporary password is shown once', temp);
await nick.getByRole('button', { name: 'Done' }).click();
ok((await nick.locator('.roster__row').count()) === 7, 'the new member appears in the list');

const durak = await t.open(); await durak.goto(t.base + '#/sign-in');
await durak.getByLabel('Name').fill('durak'); await durak.getByLabel('Password').fill(temp); await durak.getByRole('button', { name: 'Sign in' }).click();
await durak.waitForSelector('.modal');
ok((await durak.textContent('.modal')).includes('Choose your own password'), 'first sign-in forces a password change');
ok((await durak.textContent('.modal')).includes('Forgemaster can read this password'), 'the member is told the Forgemaster can read it');
await durak.getByLabel('Temporary password').fill(temp); await durak.getByLabel('New password', { exact: true }).fill('DurakOwnPass77'); await durak.getByLabel('New password again').fill('DurakOwnPass77');
await durak.getByRole('button', { name: 'Save password' }).click(); await durak.getByRole('button', { name: 'Continue' }).click();
await durak.waitForTimeout(900); ok((await durak.locator('.modal').count()) === 0 && (await menu(durak)).length === 9, 'after changing it the member is in');
// Supabase ends every session on a password change. The app must have signed this one back in,
// or the next thing that needs the server (the Members screen asks it who is online) would fail.
await go(durak, '/members', 1200);
ok((await durak.locator('.roster__row').count()) === 7 && !durak.url().includes('sign-in'), 'and stays signed in: the server still knows them after the change');
ok(await durak.evaluate(() => !!localStorage.getItem('black-tusk-session') && !sessionStorage.getItem('black-tusk-session')), 'Stay signed in keeps the session on the device');
await durak.context().close();
{
  // Unticked: the session lives only as long as the tab.
  const once = await t.open(); await once.goto(t.base + '#/sign-in');
  ok(await once.getByLabel('Stay signed in').isChecked(), 'Stay signed in is offered on the sign-in screen, ticked');
  await once.getByLabel('Stay signed in').uncheck();
  await once.getByLabel('Name').fill('UGAK'); await once.getByLabel('Password').fill('TestPass123'); await once.getByRole('button', { name: 'Sign in' }).click();
  await once.waitForSelector('.menu__nav');
  ok((await menu(once)).length === 9, 'a name typed in capitals signs in');
  ok(await once.evaluate(() => !localStorage.getItem('black-tusk-session') && !!sessionStorage.getItem('black-tusk-session')), 'unticked, nothing is left on the device after the tab closes');
  const again = await once.context().newPage(); await again.goto(t.base); await again.waitForTimeout(900);
  ok((await menu(again)).length === 2, 'a new tab starts signed out');
  await once.context().close();
}

await nick.getByText('Durak Iron-Jaw').click(); await nick.getByRole('button', { name: 'Show current password' }).click(); await nick.waitForSelector('.secret__value');
ok((await nick.locator('.secret__value').textContent()) === 'DurakOwnPass77', 'Forgemaster can view the member\'s current password');
await nick.locator('.tagpick').getByRole('button', { name: 'Deceased' }).click(); await nick.getByRole('button', { name: 'Save', exact: true }).click(); await nick.waitForSelector('.note');
await nick.getByRole('button', { name: 'Close' }).click(); await nick.waitForTimeout(400);
ok((await nick.locator('.roster__row.is-fallen').count()) === 1, 'Deceased tag is applied and shown');
const durak2 = await user('durak', 'DurakOwnPass77'); ok((await menu(durak2)).length === 9, 'a Deceased member keeps full access');
await durak2.context().close();

{ // a member fills in their own card: bio, masteries, hours
  const own = await user('velyn'); await go(own, '/members', 900);
  await own.locator('.roster__row', { hasText: '(you)' }).click(); await own.waitForSelector('.modal');
  await own.getByLabel('Bio').fill('Trader out of the Rift. Buys pelts, sells rumours.');
  await own.getByRole('button', { name: 'Add a mastery' }).click(); await own.getByLabel('Mastery 1').selectOption('skinner');
  await own.locator('.masterypick__row').nth(0).getByRole('button', { name: 'Level 5' }).click();
  await own.getByRole('button', { name: 'Add a mastery' }).click(); await own.getByLabel('Mastery 2').selectOption('lockpicking');
  ok((await own.locator('.masterypick__preview .mastery').first().textContent()).replace(/\s+/g, ' ').includes('Lvl 5') , 'the tag preview reads "Lvl 5 Skinner"', await own.locator('.masterypick__preview .mastery').first().textContent());
  await own.getByRole('button', { name: '+ Weekends' }).click();
  await own.getByLabel('Sat 9a to 10a').click();
  await own.getByRole('button', { name: 'Save', exact: true }).click(); await own.waitForSelector('.note'); await own.getByRole('button', { name: 'Close' }).click(); await own.waitForTimeout(500);
  ok((await own.locator('.roster__row', { hasText: '(you)' }).locator('.mastery--mini').count()) === 2, 'their masteries show beside their name in the list');
  await own.locator('.roster__row', { hasText: '(you)' }).click(); await own.waitForSelector('.modal');
  ok((await own.getByLabel('Bio').inputValue()).startsWith('Trader out of the Rift') && await own.getByLabel('Sat 9a to 10a').getAttribute('aria-pressed') === 'true', 'the card is still there when reopened');
  ok((await own.locator('.tagpick').count()) === 0, 'a member editing their card is offered no tags to change');
  await own.context().close();
  await go(nick, '/members', 900); await nick.getByText('Velyn of the Rift').click(); await nick.waitForSelector('.modal .about');
  const about = (await nick.locator('.modal .about').textContent()).replace(/\s+/g, ' ');
  ok(about.includes('Lvl 5') && about.includes('Skinner') && about.includes('Lockpicking') && about.includes('Buys pelts') && about.includes('Usually around'), 'other members see the bio, masteries and hours', about.slice(0, 200));
  ok((await nick.locator('.modal .about .mastery--l5 .mastery__spark').count()) === 3 && (await nick.locator('.modal .about .mastery--l0 .mastery__spark').count()) === 0, 'a level 5 tag sparkles; a level 0 tag does not');
  ok((await nick.locator('.modal').getByLabel('Bio').count()) === 0, "an officer cannot rewrite another member's bio");
  await nick.getByRole('button', { name: 'Close' }).first().click(); await nick.waitForTimeout(300);
}
const ugak = await user('ugak');
await go(ugak, '/members', 900);
ok(!(await has(ugak, 'button', 'Add member')) && !(await has(ugak, 'button', 'Discord link')), 'a Blooded member sees no admin buttons');
await ugak.getByText('Gorza gra-Largash').click(); await ugak.waitForSelector('.modal');
ok((await ugak.locator('.modal input').count()) === 0 && !(await has(ugak, 'button', 'Show current password')), 'another member\'s card is read-only');
await ugak.getByRole('button', { name: 'Close' }).click();
await ugak.locator('.roster__row', { hasText: 'Ugak' }).click(); await ugak.getByLabel('Display name').fill('Ugak the Bold'); await ugak.getByRole('button', { name: 'Save', exact: true }).click();
await ugak.waitForSelector('.note'); ok(await has(ugak, 'button', 'Change password'), 'own card offers Change password');
await ugak.getByRole('button', { name: 'Close' }).click(); await ugak.waitForTimeout(300);
ok((await ugak.textContent('.roster')).includes('Ugak the Bold'), 'a member changes their own display name');
const gorza = await user('gorza');
await go(gorza, '/members', 900); await gorza.getByText('Sharn').click(); await gorza.waitForSelector('.modal');
ok(!(await has(gorza, 'button', 'Show current password')), 'the Chieftain cannot view passwords');
ok(await gorza.locator('.tagpick__one', { hasText: 'Forgemaster' }).isDisabled(), 'the Chieftain cannot hand out the Forgemaster tag');

console.log('notice board');
await go(nick, '/notices', 800);
await nick.getByRole('button', { name: 'Post a notice' }).click();
await nick.getByLabel('Title').fill('Moot at dusk'); await nick.getByLabel('Text').fill('All gather at the fire.');
await nick.getByLabel('Take it down after').selectOption('1'); await nick.getByRole('button', { name: 'Post notice' }).click(); await nick.waitForTimeout(600);
await nick.getByRole('button', { name: 'Post a notice' }).click();
await nick.getByLabel('Title').fill('For Ugak alone'); await nick.getByText('Chosen members only').click(); await nick.locator('.audience').getByText('Ugak the Bold').click();
await nick.getByRole('button', { name: 'Post notice' }).click(); await nick.waitForTimeout(600);
ok((await nick.locator('.paper').count()) === 2, 'two notices posted');
ok((await nick.textContent('.board')).includes('Comes down in 1 days') || (await nick.textContent('.board')).includes('Comes down in 24 h'), 'the timer shows on the notice');
await go(ugak, '/notices', 800);
ok((await ugak.locator('.paper').count()) === 2 && !(await has(ugak, 'button', 'Post a notice')) && !(await has(ugak, 'button', 'Edit')), 'Ugak sees both and cannot post or edit');
const velyn = await user('velyn'); await go(velyn, '/notices', 800);
ok((await velyn.locator('.paper').count()) === 1, 'Velyn only sees the notice for everyone');
await nick.locator('.paper', { hasText: 'For Ugak alone' }).getByRole('button', { name: 'Remove' }).click(); await nick.locator('.modal').getByRole('button', { name: 'Remove' }).click(); await nick.waitForTimeout(600);
ok((await nick.locator('.paper').count()) === 1, 'an officer removes a notice');
await nick.getByRole('tab', { name: 'Change log' }).click(); await nick.waitForTimeout(400);
await nick.getByRole('button', { name: 'Add an entry' }).click(); await nick.getByLabel('Version').fill('0.2.0'); await nick.getByLabel('What changed').fill('Sharper tusks');
await nick.getByRole('button', { name: 'Save entry' }).click(); await nick.waitForTimeout(500);
ok((await nick.locator('.log__row').count()) === 2, 'Forgemaster adds a change log entry');
await go(gorza, '/notices', 700); await gorza.getByRole('tab', { name: 'Change log' }).click(); await gorza.waitForTimeout(400);
ok((await gorza.locator('.log__row').count()) === 2 && !(await has(gorza, 'button', 'Add an entry')) && !(await has(gorza, 'button', 'Edit')), 'the Chieftain reads the change log but cannot edit it');

console.log('mine deals');
await go(gorza, '/mine', 700);
ok((await gorza.textContent('.page__body')).includes('No deals are on record'), 'the mine screen starts blank');
await gorza.getByRole('button', { name: 'Add a deal' }).click(); await gorza.getByLabel('Title').fill('Iron for Riften'); await gorza.getByLabel('Text').fill('Forty ingots a week.');
await gorza.getByRole('button', { name: 'Post deal' }).click(); await gorza.waitForTimeout(600);
const sheo = await user('sheo'); await go(sheo, '/mine', 700);
ok((await sheo.locator('.paper').count()) === 1 && !(await has(sheo, 'button', 'Add a deal')), 'Daedric reads deals but cannot add them');
await gorza.context().close();

console.log('expansion goals');
const sharn = await user('sharn'); await go(sharn, '/expansion', 900);
ok((await sharn.locator('.stage').count()) === 6, 'five stages and the total are shown');
ok((await sharn.locator('.stage .stagebar').count()) === 6 && (await sharn.locator('.overall').count()) === 0, 'every stage has its own progress bar; there is no single big one');
ok((await sharn.locator('.stage--total').textContent()).replace(/\s+/g, ' ').includes('of 64,500 Septims'), 'the gold total is 64,500');
const gold = sharn.getByLabel('Gold gathered').first(); await gold.fill('500'); await gold.blur(); await sharn.waitForTimeout(600);
await go(ugak, '/expansion', 900);
ok((await ugak.locator('.res__input').count()) === 0, 'members see progress as text, not inputs');
ok((await ugak.locator('.stage').first().textContent()).includes('500'), 'the Wise Woman\'s update is saved and visible to members');
ok((await ugak.locator('.stage').first().locator('.stagebar__pct').textContent()).trim() === '0%' && (await ugak.locator('.stage').first().locator('.stagebar__track span').evaluate((e) => e.style.width)) !== '0%',
  "the first stage's own bar moved (500 of 16,000 gold is under 1%)");
ok(!(await has(ugak, 'button', 'Add a stage')) && !(await has(ugak, 'button', 'Edit')), 'members cannot edit goals');
await sharn.context().close(); await go(sheo, '/code', 300);

console.log('mining map');
await go(ugak, '/map', 2500);
{ // the map always covers its frame: zoom all the way out and drag hard in every direction
  const box = await ugak.locator('.map').boundingBox();
  const covered = () => ugak.evaluate(() => {
    const r = document.querySelector('.map').getBoundingClientRect();
    // tiles ignore the pointer, so ask each one for its own rectangle
    const tiles = [...document.querySelectorAll('img.leaflet-tile')].filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.getBoundingClientRect());
    const tileAt = (x, y) => tiles.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
    return [[r.left + r.width / 2, r.top + 3], [r.left + r.width / 2, r.bottom - 3], [r.left + 3, r.top + r.height / 2], [r.right - 3, r.top + r.height / 2],
      [r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3]].every(([x, y]) => tileAt(x, y));
  });
  await ugak.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) { await ugak.mouse.wheel(0, 500); await ugak.waitForTimeout(200); }
  await ugak.waitForTimeout(900);
  ok(await covered(), 'zoomed all the way out, the map still fills its frame');
  for (const [dx, dy] of [[600, 400], [-900, -700], [900, -600], [-800, 700]]) {
    await ugak.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await ugak.mouse.down();
    await ugak.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 }); await ugak.mouse.up(); await ugak.waitForTimeout(500);
  }
  await ugak.waitForTimeout(700);
  ok(await covered(), 'dragging stops at the border: nothing shows beyond the map');
  ok((await ugak.locator('.place--city span').allTextContents()).includes('Whiterun') && (await ugak.locator('.mapkey').textContent()).includes('Locations'), 'the walled cities are labelled and the filter is called Locations');
  await go(ugak, '/map', 2500);
}
ok((await ugak.locator('.leaflet-tile-loaded').count()) > 3, 'map tiles load');
ok((await ugak.locator('.keyrow').count()) === 10, 'ten ore filters in the key');
await ugak.getByRole('button', { name: 'Mark a vein' }).click();
const box = await ugak.locator('.map').boundingBox(); await ugak.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.55);
await ugak.waitForSelector('.sheet'); await ugak.locator('.orepick').getByRole('button', { name: 'Gold' }).click(); await ugak.getByLabel('Note').fill('Behind the waterfall');
await ugak.getByRole('button', { name: 'Send for approval' }).click(); await ugak.waitForSelector('.map__banner--ok');
ok((await ugak.textContent('.map__banner--ok')).includes('Sent for approval'), 'a member\'s ping is sent for approval');
await go(velyn, '/map', 2000); ok((await velyn.locator('.ore').count()) === 0, 'the pending ping is not on other members\' maps');
await go(nick, '/map', 2500);
ok((await nick.locator('.pendrow').count()) === 1, 'the Forgemaster sees the pending ping');
await nick.locator('.pendrow').click(); await nick.waitForTimeout(1200); await nick.getByRole('button', { name: 'Approve' }).click(); await nick.waitForSelector('.map__banner--ok');
await nick.waitForTimeout(4800);
await nick.getByRole('button', { name: 'Mark a vein' }).click();
const nb = await nick.locator('.map').boundingBox(); await nick.mouse.click(nb.x + nb.width * 0.7, nb.y + nb.height * 0.7);
await nick.waitForSelector('.sheet'); await nick.locator('.orepick').getByRole('button', { name: 'Ebony' }).click(); await nick.getByRole('button', { name: 'Add to the map' }).click();
await nick.waitForSelector('.map__banner--ok'); ok((await nick.textContent('.map__banner--ok')).includes('Added to the map'), 'a higher-up\'s marker skips approval');
await go(velyn, '/map', 2200); ok((await velyn.locator('.ore').count()) === 2, 'both approved markers are now on everyone\'s map');
await velyn.locator('.keyrow', { hasText: 'Gold' }).locator('input').uncheck(); await velyn.waitForTimeout(300);
ok((await velyn.locator('.ore').count()) === 1, 'unticking an ore hides its markers');
{ // wheel zoom, in a fresh window so nothing else holds the pointer
  const z = await user('velyn'); await go(z, '/map', 2200); await z.bringToFront();
  const zoom = () => z.evaluate(() => Number(document.querySelector('.map').dataset.zoom));
  const z0 = await zoom(); const vb = await z.locator('.map').boundingBox();
  // (a synthetic wheel event: with several windows open, headless Chromium drops real wheel input to background windows)
  await z.evaluate(([x, y]) => document.querySelector('.map').dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: x, clientY: y, bubbles: true, cancelable: true })), [vb.x + vb.width * 0.6, vb.y + vb.height / 2]);
  await z.waitForFunction((from) => Number(document.querySelector('.map').dataset.zoom) > from, z0, { timeout: 8000 }).catch(() => undefined);
  const z1 = await zoom(); ok(z1 > z0, 'scrolling zooms the map in', `${z0} -> ${z1}`);
  await z.context().close();
}

console.log('pricing ledger');
await velyn.context().close(); await go(nick, '/code', 300);
await go(ugak, '/ledger', 1800);
ok(Number((await ugak.locator('.ledger__count b').first().textContent()).replace(/,/g, '')) > 4000, 'the ledger lists thousands of items');
ok(!(await ugak.locator('.ledger').textContent()).includes('Keys'), 'there is no Keys section');
await ugak.getByLabel('Filter by name').fill('iron ingot'); await ugak.waitForTimeout(400); await ugak.locator('.lrow', { hasText: 'Iron Ingot' }).first().click(); await ugak.waitForTimeout(500);
const card = async (p) => (await p.locator('.ledger__card').textContent()).replace(/\s+/g, ' ');
ok((await card(ugak)).includes('Unknown tier') && (await card(ugak)).includes('Price unknown'), 'items start at unknown tier and unknown price');
ok((await card(ugak)).includes('Made at a smelter from 1 Iron Ore, 1 Poor Charcoal'), 'the server\'s own recipe is shown', (await card(ugak)).slice(0, 300));
ok(!(await has(ugak, 'button', 'Edit')) && !(await has(ugak, 'button', 'Add an item')), 'members cannot edit the ledger');
await go(sheo, '/ledger', 1800);
await sheo.getByLabel('Filter by name').fill('iron ingot'); await sheo.waitForTimeout(400); await sheo.locator('.lrow', { hasText: 'Iron Ingot' }).first().click(); await sheo.getByRole('button', { name: 'Edit' }).click();
await sheo.locator('.modal').getByLabel('Tier').selectOption('2'); await sheo.locator('.modal').getByLabel('Clan price').fill('12');
const png = await sharp({ create: { width: 240, height: 200, channels: 3, background: '#f4f4f4' } }).composite([{ input: await sharp({ create: { width: 120, height: 90, channels: 3, background: '#7a3b22' } }).png().toBuffer(), left: 60, top: 55 }]).png().toBuffer();
await sheo.getByLabel('Choose a picture').setInputFiles({ name: 'ingot.png', mimeType: 'image/png', buffer: png });
await sheo.waitForSelector('.imgedit__view img'); await sheo.waitForTimeout(500);
await sheo.getByRole('button', { name: 'Save', exact: true }).click(); await sheo.waitForSelector('.icard__view img', { timeout: 8000 });
ok((await card(sheo)).includes('Tier 2') && (await card(sheo)).includes('12 septims'), 'Daedric sets tier and price');
const px = await sheo.evaluate(async () => {
  const img = document.querySelector('.icard__view img'); const r = await fetch(img.src); const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  const mid = g.getImageData(bmp.width >> 1, bmp.height >> 1, 1, 1).data; return { w: bmp.width, h: bmp.height, mid: [...mid] };
});
ok(px.w === 120 && px.h === 90 && px.mid[3] === 255 && px.mid[0] > 100, 'the picture\'s background is removed and it is trimmed to the item', JSON.stringify(px));
await ugak.reload(); await ugak.waitForTimeout(1500); await ugak.getByLabel('Filter by name').fill('iron ingot'); await ugak.waitForTimeout(400); await ugak.locator('.lrow', { hasText: 'Iron Ingot' }).first().click(); await ugak.waitForTimeout(600);
ok((await card(ugak)).includes('Tier 2') && (await card(ugak)).includes('12 septims') && (await ugak.locator('.icard__view img').count()) === 1, 'members see the new tier, price and picture');
await ugak.getByRole('button', { name: 'Apparel' }).click(); await ugak.getByLabel('Filter by name').fill('orcish clan sword'); await ugak.waitForTimeout(300);
await ugak.getByRole('button', { name: 'Weapons' }).click(); await ugak.waitForTimeout(300); await ugak.locator('.lrow', { hasText: 'Orcish Clan Sword' }).first().click(); await ugak.waitForTimeout(400);
ok((await card(ugak)).includes('Largashbur Master Smith'), 'clan-only designs name the Largashbur Master Smith');

console.log('sign out');
await sheo.context().close(); await ugak.context().close();
await go(nick, '/', 500); await nick.getByRole('button', { name: 'Sign Out' }).click(); await nick.waitForTimeout(600);
ok((await menu(nick)).join('|') === 'Sign In|Code of Mauloch', 'signing out returns to the guest menu');

console.log('phone');
await nick.context().close();
const phone = await user('ugak', 'TestPass123', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const r of ['/', '/code', '/notices', '/oath', '/members', '/mine', '/expansion', '/map', '/ledger']) {
  await go(phone, r, r === '/map' ? 2200 : 900);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, `no sideways scroll on a phone at ${r}`, String(over));
}

const real = t.errors.filter((e) => !/401|403|400 \(Bad Request\)/.test(e));
ok(real.length === 0, 'no script errors in the browser', real.slice(0, 5).join(' || '));
console.log(`\n${pass} passed, ${fail} failed`);
await t.stop(); process.exit(fail ? 1 : 0);
