// Sound and Settings in a real browser: which theme is fetched when, the settings screen, the sound button.
//   node tests/sound.mjs
import { boot } from './harness.mjs';

const t = await boot();
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : (fail++, console.log('  FAIL', name, extra)); };
const menu = (page) => page.locator('.menu__item').allTextContents();
const watch = (page) => { const got = []; page.on('request', (r) => { const m = r.url().match(/\/sounds\/([a-z_]+)\.mp3/); if (m) got.push(m[1]); }); return got; };
const until = async (page, cond, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await page.waitForTimeout(150); } return cond(); };

console.log('music');
{
  const p = await t.open();
  const got = watch(p);
  await p.waitForSelector('.menu__nav'); await p.waitForTimeout(800);
  ok(got.length === 0, 'nothing is fetched or played before the first tap', got.join(','));
  await p.mouse.click(5, 5); await until(p, () => got.includes('theme_stranger'));
  ok(got.includes('theme_stranger') && !got.includes('theme_black_tusks'), 'signed out, the first tap starts the stranger\'s theme', got.join(','));
  ok(got.includes('ui_select') && got.includes('ui_hover'), 'and the menu sounds are fetched with it');
  ok(await p.evaluate(() => { const b = document.querySelector('.menu__sound'); return !!b && b.getAttribute('aria-pressed') === 'true'; }), 'the home screen has a sound button, on by default');
  await t.signIn(p, 'nick'); await until(p, () => got.includes('theme_black_tusks'));
  ok(got.includes('theme_black_tusks'), 'signed in as a Black Tusk, the Black Tusk theme takes over', got.join(','));
  await p.getByRole('button', { name: 'Visit The Scorned' }).click(); await until(p, () => got.includes('theme_scorned'));
  ok(got.includes('theme_scorned'), 'visiting the Scorned brings in the Scorned theme', got.join(','));
  // Settings, from the Scorned home screen
  await p.waitForFunction(() => !/is-fog/.test(document.querySelector('.menu').className), null, { timeout: 6000 });
  ok((await menu(p)).includes('Settings'), 'Settings is on the Scorned home screen too');
  await p.getByRole('button', { name: 'Settings', exact: true }).click(); await p.waitForSelector('.settings');
  ok((await p.textContent('.page__title')) === 'Settings' && (await p.locator('.switch').count()) === 3 && (await p.locator('.range').count()) === 2, 'Settings: sound, music and menu sounds, each with a switch, and two volumes');
  ok((await p.textContent('.settings')).includes('the Scorned theme'), 'it says which theme is playing');
  await p.getByRole('switch', { name: /^Music/ }).uncheck(); await p.locator('#set-effects-vol').fill('30');
  await p.reload(); await p.waitForSelector('.settings');
  ok(!(await p.getByRole('switch', { name: /^Music/ }).isChecked()) && (await p.locator('#set-effects-vol').inputValue()) === '30' && await p.locator('#set-music-vol').isDisabled(),
    'the choices are kept on the device, and the music volume rests while the music is off');
  await p.getByRole('switch', { name: /^Sound/ }).uncheck();
  ok(await p.getByRole('switch', { name: /^Menu sounds/ }).isDisabled(), 'turning all sound off rests the rest');
  await p.getByRole('link', { name: 'Back' }).click(); await p.waitForSelector('.menu__nav');
  ok((await p.getAttribute('.menu__sound', 'aria-pressed')) === 'false', 'the home screen\'s sound button shows it off');
  await p.click('.menu__sound');
  ok((await p.getAttribute('.menu__sound', 'aria-pressed')) === 'true', 'and turns it back on');
  await p.context().close();
}
{
  // muted from the start: no music is fetched at all
  const p = await t.open();
  await p.evaluate(() => localStorage.setItem('bt-sound', JSON.stringify({ muted: true })));
  const got = watch(p);
  await p.reload(); await p.waitForSelector('.menu__nav'); await p.mouse.click(5, 5); await p.waitForTimeout(1500);
  ok(!got.some((x) => x.startsWith('theme_')), 'with the sound off, no theme is fetched', got.join(','));
  await p.getByRole('button', { name: 'Settings', exact: true }).click(); await p.waitForSelector('.settings');
  ok((await p.textContent('.settings')).includes('the stranger’s theme') && !(await p.getByRole('switch', { name: /^Sound/ }).isChecked()), 'guests have Settings too');
  await p.context().close();
}
{
  // a Scorned member starts on the Scorned theme
  await t.backend.seedUser('zgor', 'Zgor', ['chieftain'], 'TestPass123', ['scorned']);
  const p = await t.open(); const got = watch(p);
  await t.signIn(p, 'zgor'); await p.mouse.click(5, 5);
  await until(p, () => got.includes('theme_scorned'));
  ok(got.includes('theme_scorned') && !got.includes('theme_black_tusks'), 'a Scorned member hears the Scorned theme', got.join(','));
  await p.context().close();
}
const real = t.errors.filter((e) => !/401|403|400 \(Bad Request\)/.test(e));
ok(real.length === 0, 'no script errors in the browser', real.slice(0, 5).join(' || '));
console.log(`\n${pass} passed, ${fail} failed`);
await t.stop(); process.exit(fail ? 1 : 0);
