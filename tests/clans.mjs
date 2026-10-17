// The two clans in a real browser against the local backend: home screens, the fog switch, each clan's own
// screens and who may change what.   node tests/clans.mjs
import { boot } from './harness.mjs';

const t = await boot();
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : (fail++, console.log('  FAIL', name, extra)); };
const go = async (page, route, wait = 700) => { const to = t.base + '#' + route; if (page.url() === to) await page.reload(); else await page.goto(to); await page.waitForTimeout(wait); };
const menu = (page) => page.locator('.menu__item').allTextContents();
const has = async (page, role, name) => (await page.getByRole(role, { name, exact: true }).count()) > 0;
const user = async (name, password, opts) => { const p = await t.open(opts); await t.signIn(p, name, password); return p; };
const nick = await user('nick');

console.log('0.4.0: two clans');
{
  await t.backend.seedUser('zgor', 'Zgor', ['chieftain'], 'TestPass123', ['scorned']);
  await t.backend.seedUser('shum', 'Shum', ['blooded'], 'TestPass123', ['scorned']);
  await t.backend.seedUser('twin', 'Twin', ['blooded'], 'TestPass123', ['black_tusks', 'scorned']);
  const title = (p) => p.textContent('.menu__title');
  const z = await user('zgor', undefined, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ok((await title(z)) === 'The Scorned' && (await z.evaluate(() => !document.querySelector('.scene__layer--scorned').classList.contains('is-off') && document.querySelector('.scene__layer--black_tusks').classList.contains('is-off'))),
    'a Scorned member opens on the Scorned home screen, Narzulbur behind it');
  ok((await menu(z)).join('|') === 'Sign Out|Settings|Profile|Code of Mauloch|Notice Board|Scorned Oath|Members|Deceased|Roles|Mine of the Scorned|Expansion Goals|Mining Map|Pricing Ledger|Visit The Black Tusks',
    'the Scorned menu: their own oath and mine, the way to the Black Tusks last', (await menu(z)).join('|'));
  ok((await z.getAttribute('.menu__banner .banner', 'aria-label')) === 'The Scorned flag', 'with the Scorned flag');
  ok(await z.evaluate(() => { const se = document.scrollingElement; return se.scrollHeight <= window.innerHeight + 1 && se.scrollWidth <= window.innerWidth + 1; }), 'the Scorned menu fits a phone without scrolling');
  const tw = await user('twin');
  ok((await title(tw)) === 'The Black Tusks', 'a member of both clans opens on the Black Tusks');
  await tw.context().close();

  // the Scorned's own screens
  await z.getByRole('button', { name: 'Scorned Oath' }).click(); await z.waitForSelector('.oath');
  const oath = (await z.textContent('.oath')).replace(/\s+/g, ' ');
  ok(z.url().endsWith('#/scorned/oath') && oath.startsWith('By Malacath and the Ashen Forge,') && oath.includes('I am Scorned.') && oath.includes('should I fall') && !oath.includes('Zgor') && (await z.locator('.oath__name').count()) === 0,
    'the Scorned Oath is their own text, with no name in it', oath.slice(0, 120));
  await z.getByRole('link', { name: 'Back' }).click(); await z.waitForSelector('.menu__nav');
  ok((await title(z)) === 'The Scorned', 'Back returns to the Scorned home screen');
  await z.getByRole('button', { name: 'Deceased', exact: true }).click(); await z.waitForSelector('.page .empty', { timeout: 10000 }).catch(() => undefined);
  await z.waitForFunction(() => !/Reading|Stoking/.test(document.querySelector('.page .empty')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => undefined);
  ok(z.url().endsWith('#/scorned/deceased') && (await z.textContent('.empty')).includes('No Scorned has fallen.') && (await z.textContent('.page__sub')).includes('The Scorned'), 'the Scorned Deceased list starts empty', z.url() + ' | ' + (await z.textContent('.page').catch(() => 'no page')).replace(/\s+/g, ' ').slice(0, 300));
  await go(z, '/scorned/mine', 900);
  ok((await z.textContent('.page__title')) === 'Mine of the Scorned' && (await z.textContent('.page__sub')).includes('Gloombound Mine') && await has(z, 'button', 'Add a deal'), 'the Scorned Chieftain keeps the Mine of the Scorned');
  await go(z, '/mine', 900);
  ok((await z.textContent('.page__title')) === 'Mine of the Black Tusks' && !(await has(z, 'button', 'Add a deal')), 'but cannot post in the Mine of the Black Tusks');
  await go(z, '/scorned/expansion', 1100);
  ok((await z.textContent('.page__sub')).includes('Narzulbur') && (await z.locator('.stage').count()) === 6 && (await z.locator('.res__input').count()) > 0 && await has(z, 'button', 'Add a stage'),
    'the Scorned have their own five stages (and the total), and their Chieftain keeps them');
  await go(z, '/expansion', 1100);
  ok((await z.locator('.res__input').count()) === 0 && !(await has(z, 'button', 'Add a stage')), "the Scorned Chieftain cannot change the Black Tusks' goals");
  await go(z, '/scorned/notices', 900);
  ok((await z.textContent('.page__sub')).includes('The Scorned of Narzulbur') && await has(z, 'button', 'Post a notice'), 'the Scorned Notice Board, where their Chieftain posts');
  await z.getByRole('button', { name: 'Post a notice' }).click(); await z.getByLabel('Title').fill('Muster at Narzulbur'); await z.getByRole('button', { name: 'Post notice' }).click(); await z.waitForTimeout(700);
  await z.getByRole('tab', { name: 'Change log' }).click(); await z.waitForTimeout(500);
  ok((await z.locator('.log__row').count()) >= 1 && !(await has(z, 'button', 'Add an entry')), 'the change log is the same one, read-only to them');
  await go(nick, '/notices', 900);
  ok(!(await nick.textContent('.board')).includes('Muster at Narzulbur'), "a Scorned notice stays on the Scorned board, not the Black Tusks'");
  await go(nick, '/scorned/notices', 900);
  ok((await nick.textContent('.board')).includes('Muster at Narzulbur'), 'a Black Tusk visiting reads it there');

  // visiting: the fog switch
  await go(nick, '/', 1200);
  ok((await title(nick)) === 'The Scorned', 'having visited a Scorned screen, the home screen keeps to the Scorned side');
  await nick.getByRole('button', { name: 'Visit The Black Tusks' }).click();
  // read inside the page the moment the switch begins, so a busy machine cannot miss it
  const fog = await (await nick.waitForFunction(() => {
    if (!document.querySelector('.menu').classList.contains('is-fog-out')) return false;
    return { title: document.querySelector('.menu__title').textContent, bt: !document.querySelector('.scene__layer--black_tusks')?.classList.contains('is-off'),
      sharp: [document.querySelector('.menu__flag .banner'), document.querySelector('.menu__title')].every((el) => !/blur/.test(getComputedStyle(el).filter)) };
  }, null, { timeout: 3000, polling: 'raf' })).jsonValue();
  ok(fog.title === 'The Scorned' && fog.bt, 'the switch: the banner sinks into fog while Largashbur fades in behind', JSON.stringify(fog));
  ok(fog.sharp, 'the banner and the title fade sharp, never blurred');
  await nick.waitForFunction(() => document.querySelector('.menu__title').textContent === 'The Black Tusks', null, { timeout: 5000 });
  await nick.waitForFunction(() => !/is-fog/.test(document.querySelector('.menu').className), null, { timeout: 5000 });
  ok((await menu(nick)).includes('Black Tusk Oath') && (await menu(nick)).includes('Visit The Scorned'), 'then the Black Tusk banner, title and menu rise out of it');

  // Members: the filter and the clan pennants
  await go(nick, '/members', 1200);
  const rows = () => nick.locator('.roster__row').count();
  const all = await rows();
  await nick.getByRole('tab', { name: 'Scorned Only' }).click(); await nick.waitForTimeout(300);
  const sc = await rows(); const scNames = await nick.locator('.roster__name').allTextContents();
  await nick.getByRole('tab', { name: 'Black Tusks Only' }).click(); await nick.waitForTimeout(300);
  const bt = await rows();
  ok(sc === 3 && scNames.some((n) => n.startsWith('Zgor')) && scNames.some((n) => n.startsWith('Twin')) && bt + sc - 1 === all, 'the filter shows all members, Black Tusks only or Scorned only', `${all} ${bt} ${sc}`);
  await nick.getByRole('tab', { name: 'All Members' }).click(); await nick.waitForTimeout(300);
  const pen = await nick.locator('.roster__row', { hasText: 'Twin' }).locator('.pennant').allTextContents();
  ok(pen.join('|') === 'The Black Tusks Clan|The Scorned Clan' && await nick.evaluate(() => { const p = document.querySelector('.pennant'); return getComputedStyle(p).clipPath.includes('polygon') && getComputedStyle(p).borderRadius === '0px'; }),
    'clan tags show as pennants, apart from the round role tags');
  await nick.locator('.roster__row', { hasText: 'Shum' }).click(); await nick.getByRole('button', { name: 'Edit' }).click(); await nick.waitForTimeout(300);
  ok((await nick.locator('.clanpick__one').count()) === 2 && await nick.locator('.tagpick__one', { hasText: 'Forgemaster' }).isDisabled(), 'the Forgemaster edits clan tags; nobody can be given the Forgemaster tag, not even by him');
  await nick.locator('.clanpick__one', { hasText: 'The Black Tusks Clan' }).click();
  await nick.locator('.modal').getByRole('button', { name: /^Save/ }).click(); await nick.waitForTimeout(900);
  await nick.keyboard.press('Escape'); await nick.waitForTimeout(200);
  await nick.getByRole('tab', { name: 'Black Tusks Only' }).click(); await nick.waitForTimeout(300);
  ok((await nick.locator('.roster__name').allTextContents()).some((n) => n.startsWith('Shum')), 'and the change takes', (await nick.locator('.roster__name').allTextContents()).join(','));
  await nick.getByRole('tab', { name: 'All Members' }).click();
  const gz = await user('gorza');
  await go(gz, '/members', 1100);
  await gz.locator('.roster__row', { hasText: 'Zgor' }).click(); await gz.waitForTimeout(300);
  ok(!(await has(gz, 'button', 'Edit')), "the Black Tusk Chieftain cannot edit the Scorned Chieftain's card");
  await gz.keyboard.press('Escape'); await gz.waitForTimeout(200);
  await gz.locator('.roster__row', { hasText: 'Ugak' }).click(); await gz.getByRole('button', { name: 'Edit' }).click(); await gz.waitForTimeout(300);
  ok((await gz.locator('.clanpick__one').count()) === 0 && (await gz.textContent('.modal')).includes('Only the Forgemaster changes clan tags'), 'an officer edits their own members but not clan tags');
  ok(await has(gz, 'button', 'Remove member'), 'the Chieftain may remove a member of the clan');
  await gz.keyboard.press('Escape'); await gz.waitForTimeout(200);
  await gz.locator('.roster__row', { hasText: 'Nick' }).click(); await gz.waitForTimeout(300);
  ok(!(await has(gz, 'button', 'Remove member')), 'but never the Forgemaster');
  await gz.keyboard.press('Escape'); await gz.waitForTimeout(200);
  const sh = await user('sharn'); await go(sh, '/members', 1100);
  await sh.locator('.roster__row', { hasText: 'Ugak' }).click(); await sh.getByRole('button', { name: 'Edit' }).click(); await sh.waitForTimeout(300);
  ok(!(await has(sh, 'button', 'Remove member')), 'the Wise Woman edits members but cannot remove them');
  await sh.context().close();
  await gz.context().close();
  await z.context().close();

  // signed out, the home screen turns from one clan to the other
  const out = await t.open();
  await out.waitForSelector('.menu__nav'); await out.waitForTimeout(600);
  ok((await title(out)) === 'The Black Tusks', 'signed out, the home screen starts at the Black Tusks');
  await out.waitForFunction(() => document.querySelector('.menu__title').textContent === 'The Scorned', null, { timeout: 14000 }).catch(() => undefined);
  ok((await title(out)) === 'The Scorned' && (await menu(out)).join('|') === 'Sign In|Settings|Code of Mauloch', 'then turns to the Scorned, with the same guest menu');
  await out.waitForFunction(() => document.querySelector('.menu__title').textContent === 'The Black Tusks', null, { timeout: 14000 }).catch(() => undefined);
  ok((await title(out)) === 'The Black Tusks', 'and back again');
  await out.context().close();
}


const real = t.errors.filter((e) => !/401|403|400 \(Bad Request\)/.test(e));
ok(real.length === 0, 'no script errors in the browser', real.slice(0, 5).join(' || '));
console.log(`\n${pass} passed, ${fail} failed`);
await t.stop(); process.exit(fail ? 1 : 0);
