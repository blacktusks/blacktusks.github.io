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
{
  const html = await (await fetch(t.base)).text();
  ok(/<div id="splash"/.test(html) && html.indexOf('id="splash"') < html.indexOf('id="root"'), 'the loading screen is in the page itself, ahead of the app');
}
const g = await t.open();
await g.waitForSelector('.menu__nav');
await g.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 15000 }).catch(() => undefined);
ok(await g.evaluate(() => !document.getElementById('splash') && document.documentElement.classList.contains('is-loaded')), 'the loading screen lifts once the menu is whole');
ok(await g.evaluate(() => document.querySelector('.scene').classList.contains('is-sharp') && document.querySelector('.menu__banner .banner').classList.contains('is-ready')),
  'and by then the picture behind the menu and the banner have both arrived');
ok(await g.evaluate(() => { const se = document.scrollingElement; return se.scrollHeight <= window.innerHeight + 1 && se.scrollWidth <= window.innerWidth + 1; }), 'the main menu never scrolls');
ok((await menu(g)).join('|') === 'Sign In|Settings|Code of Mauloch', 'guest menu is Sign In, Settings below it, then Code of Mauloch', (await menu(g)).join('|'));
await g.getByRole('button', { name: 'Code of Mauloch' }).click();
await g.waitForSelector('.shrine'); await g.waitForFunction(() => document.querySelector('.shrine__statue')?.complete);
ok(g.url().endsWith('#/code') && await has(g, 'button', 'The Seven Tenets') && await has(g, 'button', 'Praise Malacath') && (await g.locator('.tenet').count()) === 0,
  'Code of Mauloch opens a menu of its own: the Seven Tenets and Praise Malacath');
ok(await g.evaluate(() => { const i = document.querySelector('.shrine__statue'); const b = i.getBoundingClientRect(); return i.naturalWidth > 900 && b.height > 200; }), 'the statue of Malacath stands on the screen');
ok(await g.evaluate(() => {
  const order = ['.shrine__nav', '.shrine__stage', '.shrine__praise'].map((q) => document.querySelector(q).getBoundingClientRect().top);
  return order[0] < order[1] && order[1] < order[2];
}), 'the Seven Tenets button, then the statue, then the Praise button');
ok((await g.locator('.shrine__fog').count()) === 3 && await g.evaluate(() => getComputedStyle(document.querySelector('.shrine__fog--far i')).animationName === 'drift-fog'
  && +getComputedStyle(document.querySelector('.shrine__fog--far')).zIndex < +getComputedStyle(document.querySelector('.shrine__statue')).zIndex), 'fog drifts behind the statue');
ok(await g.evaluate(async () => {   // the embers are drawing
  const c = document.querySelector('.shrine__embers'); await new Promise((r) => setTimeout(r, 900));
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 20) lit++; return lit > 40;
}), 'embers drift over the shrine, as on the home screen');
ok(await g.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1), 'the shrine fits the screen without scrolling');
{ // Praise Malacath: green hands in fire, and one of his sayings out of the fog
  const words = await g.evaluate(async () => (await import('/src/lib/malacath.ts')).MALACATH_WORDS);
  ok(words.length >= 50 && new Set(words).size === words.length, `a bank of ${words.length} different sayings`);
  const never = await g.evaluate(async (count) => {
    const { pickWord } = await import('/src/screens/CodeOfMauloch.tsx');
    let last = -1, repeats = 0; const seen = new Set();
    for (let i = 0; i < 3000; i++) { const n = pickWord(last, count); if (n === last || n < 0 || n >= count) repeats++; seen.add(n); last = n; }
    return { repeats, seen: seen.size };
  }, words.length);
  ok(never.repeats === 0 && never.seen === words.length, 'the saying is never the one just said, and every one comes up in time', JSON.stringify(never));
  await g.getByRole('button', { name: 'Praise Malacath' }).click(); await g.waitForTimeout(250);
  const first = await g.evaluate(() => {
    const b = document.querySelector('.shrine .burst'); const z = (q) => +getComputedStyle(b.querySelector(q)).zIndex;
    return { hands: !!b?.querySelector('.burst__hands'), green: /hue-rotate/.test(getComputedStyle(b.querySelector('.burst__hands')).filter), behind: z('.burst__fire') < z('.burst__hands'),
      sparks: b.querySelectorAll('.burst__spark').length, text: document.querySelector('.oracle__text')?.textContent };
  });
  ok(first.hands && first.green && first.behind && first.sparks === 10, 'praising sends up green hands with fire behind them and small flames flying out', JSON.stringify(first));
  ok(words.includes(first.text), 'and one of his sayings rises from the fog', first.text);
  ok(await g.evaluate(() => getComputedStyle(document.querySelector('.oracle__in')).animationName === 'oracle-in' && getComputedStyle(document.querySelector('.oracle__in')).animationDuration === '10s'),
    'it comes out of the fog, holds, and sinks back over ten seconds (six of them held)');
  ok(await g.evaluate(() => { const st = getComputedStyle(document.querySelector('.oracle__text')); return /drop-shadow/.test(st.filter) && /gradient/.test(st.backgroundImage) && st.animationName === 'oracle-shine'; }),
    'the words glow, with a light passing over them');
  ok((await g.locator('.shrine .burst').count()) >= 1, 'praising sends up the fire');
  // Praised again while a saying is still rising: it finishes rising first, then sinks back as the next rises.
  // Timed inside the page, so a slow machine cannot blur the moments being checked.
  await go(g, '/code', 900);
  const seq = await g.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Praise Malacath'));
    const snap = () => [...document.querySelectorAll('.oracle')].map((o) => ({ text: o.querySelector('.oracle__text').textContent, leaving: o.classList.contains('is-leaving'), anim: getComputedStyle(o.querySelector('.oracle__in')).animationName }));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    btn.click(); await wait(300); for (let i = 0; i < 4; i++) btn.click(); await wait(100);
    const a = snap(); const bursts = document.querySelectorAll('.shrine .burst').length;
    await wait(1700); const b = snap(); await wait(2800); const c = snap();
    btn.click(); await wait(200); const d = snap();
    return { a, b, c, d, bursts };
  });
  ok(seq.a.length === 1 && !seq.a[0].leaving && seq.bursts >= 3, 'praising again while a saying is still rising sends more fire, and the saying keeps rising', JSON.stringify(seq.a));
  ok(seq.b.length === 2 && seq.b[0].text === seq.a[0].text && seq.b[0].leaving && seq.b[0].anim === 'oracle-out' && !seq.b[1].leaving && seq.b[1].text !== seq.a[0].text && words.includes(seq.b[1].text),
    'once it has risen it sinks back early while the next saying rises in its place, both at once (several presses make one change)', JSON.stringify(seq.b));
  ok(seq.c.length === 1 && seq.c[0].text === seq.b[1].text, 'the old saying is gone after its fade, the new one stays', JSON.stringify(seq.c));
  ok(seq.d.length === 2 && seq.d[0].leaving && seq.d[0].text === seq.c[0].text && !seq.d[1].leaving && seq.d[1].text !== seq.c[0].text, 'praising a saying that has fully risen changes it at once', JSON.stringify(seq.d));
  await g.waitForTimeout(10300);
  ok((await g.locator('.oracle').count()) === 0, 'after its time the saying is gone back into the fog');
  await g.getByRole('button', { name: 'Praise Malacath' }).click(); await g.waitForTimeout(250);
  const second = await g.locator('.oracle__text').textContent();
  ok(words.includes(second) && second !== seq.d[1].text, 'the next praise brings a different saying', `${seq.d[1].text} / ${second}`);
}
await g.getByRole('button', { name: 'The Seven Tenets' }).click();
ok((await g.locator('.tenet').count()) === 7 && g.url().endsWith('#/code/tenets'), 'The Seven Tenets opens the usual tenets screen');
ok((await g.locator('.tenet__name').allTextContents())[6] === 'Let Every Clan Keep Its Fire Without Treachery', 'seventh tenet title matches');
ok((await g.textContent('.scroll')).includes('Treachery poisons every Orcish fire.'), 'closing line present');
await g.getByRole('link', { name: 'Back' }).click(); await g.waitForSelector('.shrine');
ok(g.url().endsWith('#/code'), 'Back from the tenets returns to the Code of Mauloch');
await g.getByRole('link', { name: 'Back' }).click(); await g.waitForSelector('.menu__nav');
ok(g.url().replace(/\/$/, '').endsWith('#'), 'and Back from there returns to the main menu', g.url());
await go(g, '/members'); ok(g.url().endsWith('#/sign-in'), 'guests are sent to sign in from member screens');
await g.getByLabel('Name').fill('nick'); await g.getByLabel('Password').fill('wrong-password'); await g.getByRole('button', { name: 'Sign in' }).click();
await g.waitForSelector('.error'); ok((await g.textContent('.error')).includes('do not match'), 'wrong password is refused with a clear message');
await g.context().close();

console.log('member menu');
const nick = await user('nick');
ok((await menu(nick)).join('|') === 'Sign Out|Settings|Profile|Code of Mauloch|Notice Board|Black Tusk Oath|Members|Deceased|Roles|Mine of the Black Tusks|Expansion Goals|Mining Map|Pricing Ledger|Visit The Scorned', 'member menu has its options in order: Settings below Sign Out, Profile above Code of Mauloch, Deceased and Roles below Members, the way to the Scorned last', (await menu(nick)).join('|'));
ok((await nick.textContent('.menu__title')) === 'The Black Tusks', 'a Black Tusk opens on the Black Tusks\' home screen');
ok(await nick.evaluate(() => { const se = document.scrollingElement; return se.scrollHeight <= window.innerHeight + 1 && se.scrollWidth <= window.innerWidth + 1; }), 'the longer member menu still does not scroll');
{ // Profile opens your own card, the same pop-up as your name on the Members screen
  await nick.getByRole('button', { name: 'Profile', exact: true }).click(); await nick.waitForSelector('.modal');
  ok((await nick.locator('.modal__head').textContent()) === 'Nick' && (await nick.locator('.modal input').count()) === 0 && (await nick.locator('.modal .presence--app').count()) === 1,
    'Profile on the main menu opens your own card as others see it', await nick.locator('.modal__head').textContent());
  await nick.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
  ok((await nick.getByLabel('Display name').inputValue()) === 'Nick' && (await nick.getByLabel('Bio').count()) === 1 && await has(nick, 'button', 'Change password') && (await nick.locator('.tagpick').count()) === 1,
    'and Edit there is the same form: name, bio, masteries, hours, password');
  await nick.getByLabel('Bio').fill('Keeps the forge and the companion.'); await nick.getByRole('button', { name: 'Save', exact: true }).click(); await nick.waitForSelector('.modal .note');
  ok((await nick.textContent('.modal')).includes('Keeps the forge and the companion.') && nick.url().endsWith('/'), 'a change saved from Profile shows on the card, without leaving the main menu');
  await nick.locator('.modal').getByRole('button', { name: 'Close' }).click(); await nick.waitForTimeout(300);
  ok((await nick.locator('.modal').count()) === 0, 'the card closes back to the menu');
}
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
await nick.waitForSelector('.roster__row', { timeout: 15000 }).catch(() => undefined); await nick.waitForTimeout(400);   // a cold start can take a moment
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
await durak.waitForTimeout(900); ok((await durak.locator('.modal').count()) === 0 && (await menu(durak)).length === 14, 'after changing it the member is in');
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
  ok((await menu(once)).length === 14, 'a name typed in capitals signs in');
  ok(await once.evaluate(() => !localStorage.getItem('black-tusk-session') && !!sessionStorage.getItem('black-tusk-session')), 'unticked, nothing is left on the device after the tab closes');
  const again = await once.context().newPage(); await again.goto(t.base); await again.waitForTimeout(900);
  ok((await menu(again)).length === 3, 'a new tab starts signed out');
  await once.context().close();
}

await nick.getByText('Durak Iron-Jaw').click(); await nick.waitForSelector('.modal');
ok((await nick.locator('.modal input').count()) === 0 && !(await has(nick, 'button', 'Show current password')) && (await nick.locator('.tagpick').count()) === 0,
  'an officer opening a member sees the plain card first, with nothing to edit');
ok(!(await has(nick, 'button', 'Pay Respect')), 'a living member has no Pay Respect button');
await nick.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
await nick.getByRole('button', { name: 'Show current password' }).click(); await nick.waitForSelector('.secret__value');
ok((await nick.locator('.secret__value').textContent()) === 'DurakOwnPass77', 'Forgemaster can view the member\'s current password');
ok((await nick.locator('.tagpick__one', { hasText: 'Daedric' }).count()) === 0 && (await nick.locator('.tagpick__one').count()) === 11, 'there is no Daedric tag to hand out any more');
await nick.locator('.tagpick').getByRole('button', { name: 'Deceased' }).click();
ok((await nick.textContent('.modal')).includes('moves Durak Iron-Jaw from Members to Deceased'), 'ticking Deceased says what saving will do');
await nick.getByRole('button', { name: 'Save', exact: true }).click(); await nick.waitForSelector('.page__body > .note');
ok((await nick.locator('.modal').count()) === 0 && (await nick.textContent('.page__body > .note')).includes('Durak Iron-Jaw now rests among the Deceased'), 'saving with the Deceased tag closes the card and says where they went');
ok((await nick.locator('.roster__row').count()) === 6 && (await nick.locator('.roster__row', { hasText: 'Durak' }).count()) === 0 && (await nick.textContent('.page__sub')).includes('6 by the fire'),
  'a Deceased member is no longer listed or counted under Members');

console.log('deceased');
await go(nick, '/deceased', 900); await nick.waitForSelector('.roster__row');
ok((await nick.locator('.page__title').textContent()) === 'Deceased' && (await nick.locator('.roster__row').count()) === 1 && (await nick.textContent('.page__sub')).includes('1 fallen')
  && !(await has(nick, 'button', 'Add member')) && !(await has(nick, 'button', 'Discord link')), 'the Deceased screen lists only the fallen, with no Add member button');
ok((await nick.locator('.roster .dot').count()) === 0 && (await nick.locator('.roster .presence').count()) === 0 && (await nick.locator('.roster__status').count()) === 0, 'the fallen are listed with no online dot or status');
await nick.getByText('Durak Iron-Jaw').click(); await nick.waitForSelector('.modal');
const fallenCard = async (page) => (await page.textContent('.modal')).replace(/\s+/g, ' ');
ok((await nick.locator('.modal .presence').count()) === 0 && !/On the app|Offline|In Discord|In the realm/.test(await fallenCard(nick)), 'and their card has none either');
ok((await fallenCard(nick)).includes('Passage of honor') && (await fallenCard(nick)).includes('Not yet written') && (await fallenCard(nick)).indexOf('Passage of honor') < (await fallenCard(nick)).indexOf('Cause of death'),
  'a fallen card has a passage of honor above the cause of death', await fallenCard(nick));
{ // Pay Respect: green praying hands and a fire rise from the button and are gone in a moment
  await nick.getByRole('button', { name: 'Pay Respect' }).click(); await nick.waitForTimeout(250);
  const burst = await nick.evaluate(() => {
    const b = document.querySelector('.modal .burst'); if (!b) return null; const z = (q) => +getComputedStyle(b.querySelector(q)).zIndex;
    const sparks = [...b.querySelectorAll('.burst__spark')];
    return { tint: getComputedStyle(b.querySelector('.burst__hands')).filter, fire: getComputedStyle(b.querySelector('.burst__fire')).filter, behind: z('.burst__fire') < z('.burst__hands'),
      sparks: sparks.length, spread: new Set(sparks.map((s) => s.style.getPropertyValue('--dx'))).size, turns: sparks.every((s) => parseFloat(s.style.getPropertyValue('--r1')) !== 0),
      flames: sparks.every((s) => s.textContent === '🔥'), anim: getComputedStyle(sparks[0]).animationName };
  });
  ok(burst && /hue-rotate/.test(burst.tint) && burst.fire === 'none' && burst.behind, 'Pay Respect shows green praying hands with a plain fire behind them', JSON.stringify(burst));
  ok(burst?.sparks === 10 && burst.spread === 10 && burst.turns && burst.flames && burst.anim === 'burst-spark', 'and small flames fly out all round, each turning as it goes', JSON.stringify(burst));
  await nick.getByRole('button', { name: 'Pay Respect' }).click(); await nick.waitForTimeout(150);
  ok((await nick.locator('.modal .burst').count()) === 2, 'pressing again pays respect again');
  await nick.waitForTimeout(2700);
  ok((await nick.locator('.modal .burst').count()) === 0 && (await nick.locator('.modal').count()) === 1, 'they fade and are gone within a moment, and the card stays open');
}
ok((await fallenCard(nick)).includes('Cause of death') && (await fallenCard(nick)).includes('Not yet recorded') && (await fallenCard(nick)).includes('Date of passing')
  && (await nick.locator('.fallen__date.is-blank').count()) === 1 && (await nick.locator('.fallen__date').textContent()).trim() === ''
  && !/Bio|Usually around|UNKNOWN/.test(await fallenCard(nick)), 'a fallen card shows a cause of death and an empty date of passing in place of a bio and hours', await fallenCard(nick));
await nick.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
ok((await nick.getByLabel('Bio').count()) === 0 && (await nick.locator('.modal .avail').count()) === 0 && (await nick.getByLabel('Passage of honor').count()) === 1 && (await nick.getByLabel('Cause of death').count()) === 1 && (await nick.getByLabel('Date of passing').count()) === 1
  && !(await has(nick, 'button', 'Pay Respect')), 'its form has no bio and no hours, and an officer gets passage of honor, cause of death and date of passing');
await nick.getByLabel('Passage of honor').fill('Durak stood where others ran. The fire of Largashbur remembers him.');
await nick.getByLabel('Cause of death').fill('Fell holding the gate against a giant.'); await nick.getByLabel('Date of passing').fill('2026-10-03');
await nick.getByRole('button', { name: 'Save', exact: true }).click(); await nick.waitForSelector('.modal .note');
ok((await fallenCard(nick)).includes('Fell holding the gate against a giant.') && (await fallenCard(nick)).includes('October 3, 2026'), 'an officer records the cause of death and the date of passing', await fallenCard(nick));
ok((await nick.locator('.fallen__honor').textContent()) === 'Durak stood where others ran. The fire of Largashbur remembers him.' && (await fallenCard(nick)).indexOf('Durak stood where others ran') < (await fallenCard(nick)).indexOf('Fell holding the gate'),
  'and the passage of honor, which reads above the cause of death');
await nick.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
await nick.getByLabel('Date unknown').check();
ok(await nick.getByLabel('Date of passing').isDisabled(), 'ticking Date unknown puts the date aside');
await nick.getByRole('button', { name: 'Save', exact: true }).click(); await nick.waitForSelector('.modal .note');
ok((await nick.locator('.fallen__date').textContent()).trim() === 'UNKNOWN' && !(await fallenCard(nick)).includes('October 3'), 'an unknown date of passing reads UNKNOWN');
await nick.locator('.modal').getByRole('button', { name: 'Close' }).click(); await nick.waitForTimeout(300);
{ // the fallen keep their account; their own card has nothing of the living on it
  const durak2 = await user('durak', 'DurakOwnPass77'); ok((await menu(durak2)).length === 14, 'a Deceased member keeps full access');
  await go(durak2, '/members', 900); await durak2.waitForSelector('.roster__row');
  ok((await durak2.locator('.roster__row', { hasText: '(you)' }).count()) === 0, 'they do not find themselves under Members');
  await go(durak2, '/', 300); await durak2.getByRole('button', { name: 'Profile', exact: true }).click(); await durak2.waitForSelector('.modal');
  ok((await fallenCard(durak2)).includes('Fell holding the gate against a giant.') && (await fallenCard(durak2)).includes('UNKNOWN') && (await fallenCard(durak2)).includes('Durak stood where others ran'), 'their Profile is the Deceased card');
  ok((await durak2.locator('.modal .presence').count()) === 0 && !(await has(durak2, 'button', 'Pay Respect')), 'with no online status on it, and no Pay Respect button on their own card');
  await durak2.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
  ok((await durak2.getByLabel('Display name').count()) === 1 && await has(durak2, 'button', 'Change password') && (await durak2.getByLabel('Bio').count()) === 0 && (await durak2.locator('.modal .avail').count()) === 0
    && (await durak2.getByLabel('Passage of honor').count()) === 0 && (await durak2.getByLabel('Cause of death').count()) === 0 && (await durak2.getByLabel('Date of passing').count()) === 0 && (await fallenCard(durak2)).includes("recorded by the clan's officers"),
    'they can still edit their name and password, but not a bio, hours, or their own death');
  await durak2.context().close();
}
await go(nick, '/members', 900); await nick.waitForSelector('.roster__row');

{ // a member fills in their own card: bio, masteries, hours
  const own = await user('velyn'); await go(own, '/members', 900);
  await own.locator('.roster__row', { hasText: '(you)' }).click(); await own.waitForSelector('.modal');
  ok((await own.locator('.modal textarea, .modal input, .modal select').count()) === 0 && (await own.textContent('.modal')).includes('Nothing on your card yet'),
    'your own card opens as others see it, not as a form');
  await own.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
  await own.getByLabel('Bio').fill('Trader out of the Rift. Buys pelts, sells rumours.');
  await own.getByRole('button', { name: 'Add a mastery' }).click(); await own.getByLabel('Mastery 1').selectOption('skinner');
  await own.locator('.masterypick__row').nth(0).getByRole('button', { name: 'Level 5' }).click();
  await own.getByRole('button', { name: 'Add a mastery' }).click(); await own.getByLabel('Mastery 2').selectOption('lockpicking');
  ok((await own.locator('.masterypick__preview .mastery').first().textContent()).replace(/\s+/g, ' ').includes('Lvl 5') , 'the tag preview reads "Lvl 5 Skinner"', await own.locator('.masterypick__preview .mastery').first().textContent());
  await own.getByRole('button', { name: '+ Weekends' }).click();
  await own.getByLabel('Sat 9a to 10a').click();
  await own.getByRole('button', { name: 'Save', exact: true }).click(); await own.waitForSelector('.note'); await own.getByRole('button', { name: 'Close' }).click(); await own.waitForTimeout(500);
  ok((await own.locator('.roster__row', { hasText: '(you)' }).locator('.mastery--mini').count()) === 2, 'their masteries show beside their name in the list');
  await own.locator('.roster__row', { hasText: '(you)' }).click(); await own.waitForSelector('.modal .about');
  const mine = (await own.locator('.modal .about').textContent()).replace(/\s+/g, ' ');
  ok(mine.includes('Buys pelts') && mine.includes('Skinner') && mine.includes('These hours are shown in your time'), 'reopened, your card shows what you saved and says whose clock the hours are on', mine.slice(0, 160));
  await own.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
  ok((await own.getByLabel('Bio').inputValue()).startsWith('Trader out of the Rift') && await own.getByLabel('Sat 9a to 10a').getAttribute('aria-pressed') === 'true', 'Edit opens the form with the saved card in it');
  ok((await own.locator('.tagpick').count()) === 0, 'a member editing their card is offered no tags to change');
  await own.context().close();
  await go(nick, '/members', 900); await nick.getByText('Velyn of the Rift').click(); await nick.waitForSelector('.modal .about');
  const about = (await nick.locator('.modal .about').textContent()).replace(/\s+/g, ' ');
  ok(about.includes('Lvl 5') && about.includes('Skinner') && about.includes('Lockpicking') && about.includes('Buys pelts') && about.includes('Usually around'), 'other members see the bio, masteries and hours', about.slice(0, 200));
  ok((await nick.locator('.modal .about .mastery--l5 .mastery__spark').count()) === 3 && (await nick.locator('.modal .about .mastery--l0 .mastery__spark').count()) === 0, 'a level 5 tag sparkles; a level 0 tag does not');
  ok(about.includes('These hours are shown in your time') && about.includes('converted automatically'), 'the hours carry a note that they are converted to the viewer\'s own time', about.slice(-220));
  await nick.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
  ok((await nick.locator('.modal').getByLabel('Bio').count()) === 0 && (await nick.locator('.availedit').count()) === 0, "an officer cannot rewrite another member's bio or hours");
  ok((await nick.locator('.masterypick__row').count()) === 2, 'but the officer is offered their masteries');
  await nick.locator('.masterypick__row').nth(1).getByRole('button', { name: 'Level 3' }).click();
  await nick.getByRole('button', { name: 'Add a mastery' }).click();
  ok((await nick.getByLabel('Mastery 3').locator('option').allTextContents()).slice(0, 5).join('|') === 'One Handed|Two Handed|Dual Wielder|Bow|Armor', 'Bow is among the masteries, with the other weapons', (await nick.getByLabel('Mastery 3').locator('option').allTextContents()).join('|'));
  await nick.getByLabel('Mastery 3').selectOption('bow');
  await nick.locator('.masterypick__row').nth(2).getByRole('button', { name: 'Level 2' }).click();
  await nick.getByRole('button', { name: 'Save', exact: true }).click(); await nick.waitForSelector('.note'); await nick.waitForTimeout(500);
  const after = (await nick.locator('.modal .about').textContent()).replace(/\s+/g, ' ');
  ok(/Lvl 3\s*Lockpicking/.test(after) && /Lvl 2\s*Bow/.test(after) && after.includes('Buys pelts'), "an officer changes another member's masteries; their bio is untouched", after.slice(0, 160));
  await nick.getByRole('button', { name: 'Close' }).first().click(); await nick.waitForTimeout(300);
  {
    const far = await t.open({ timezoneId: 'Europe/London' }); await t.signIn(far, 'ugak'); await go(far, '/members', 900);
    await far.getByText('Velyn of the Rift').click(); await far.waitForSelector('.modal .about');
    const note = (await far.locator('.avail__zone').textContent()).replace(/\s+/g, ' ');
    ok(note.includes('shown in your time') && note.includes('Europe/London') && /Their time zone is/.test(note), 'a viewer in another zone is told the hours are in their own time, and what the member\'s zone is', note);
    await far.context().close();
  }
}
const ugak = await user('ugak');
await go(ugak, '/members', 900);
ok(!(await has(ugak, 'button', 'Add member')) && !(await has(ugak, 'button', 'Discord link')), 'a Blooded member sees no admin buttons');
await ugak.getByText('Gorza gra-Largash').click(); await ugak.waitForSelector('.modal');
ok((await ugak.locator('.modal input').count()) === 0 && !(await has(ugak, 'button', 'Show current password')), 'another member\'s card is read-only');
ok(!(await has(ugak, 'button', 'Edit')), 'and has no Edit button');
await ugak.getByRole('button', { name: 'Close' }).click();
await ugak.locator('.roster__row', { hasText: 'Ugak' }).click(); await ugak.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
ok(await has(ugak, 'button', 'Change password'), 'own card offers Change password once editing');
await ugak.getByLabel('Display name').fill('Ugak the Bold'); await ugak.getByRole('button', { name: 'Save', exact: true }).click();
await ugak.waitForSelector('.note');
await ugak.getByRole('button', { name: 'Close' }).click(); await ugak.waitForTimeout(300);
ok((await ugak.textContent('.roster')).includes('Ugak the Bold'), 'a member changes their own display name');
const gorza = await user('gorza');
await go(gorza, '/members', 900); await gorza.getByText('Sharn').click(); await gorza.waitForSelector('.modal');
await gorza.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click();
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
await velyn.waitForSelector('.paper', { timeout: 15000 }).catch(() => undefined); await velyn.waitForTimeout(400);
ok((await velyn.locator('.paper').count()) === 1, 'Velyn only sees the notice for everyone', `saw ${await velyn.locator('.paper').count()}: ${(await velyn.locator('.paper').allTextContents()).join(' / ').slice(0, 200)}`);
await nick.locator('.paper', { hasText: 'For Ugak alone' }).getByRole('button', { name: 'Remove' }).click(); await nick.locator('.modal').getByRole('button', { name: 'Remove' }).click(); await nick.waitForTimeout(600);
ok((await nick.locator('.paper').count()) === 1, 'an officer removes a notice');
await nick.getByRole('tab', { name: 'Change log' }).click(); await nick.waitForTimeout(400);
await nick.getByRole('button', { name: 'Add an entry' }).click(); await nick.getByLabel('Version').fill('0.2.0'); await nick.getByLabel('What changed').fill('Sharper tusks');
await nick.getByRole('button', { name: 'Save entry' }).click(); await nick.waitForTimeout(500);
ok((await nick.locator('.log__row').count()) === 2, 'Forgemaster adds a change log entry');
{ // entries fold: the newest starts open, the rest shut, and each opens and shuts on its own
  const heads = nick.locator('.log__head');
  ok((await nick.locator('.log__row.is-open').count()) === 1 && (await heads.nth(0).getAttribute('aria-expanded')) === 'true' && (await heads.nth(1).getAttribute('aria-expanded')) === 'false'
    && !(await nick.textContent('.log')).includes('First build of the Black Tusk companion'), 'only the newest change log entry starts open');
  await heads.nth(1).click(); await nick.waitForTimeout(250);
  ok((await nick.locator('.log__row.is-open').count()) === 2 && (await nick.textContent('.log')).includes('First build of the Black Tusk companion'), 'an older entry opens when its line is pressed');
  await heads.nth(0).click(); await nick.waitForTimeout(250);
  ok((await nick.locator('.log__row.is-open').count()) === 1 && (await heads.nth(0).getAttribute('aria-expanded')) === 'false' && (await nick.locator('.log__more').count()) === 1, 'and an open one folds shut');
  await heads.nth(1).focus(); await nick.keyboard.press('Enter'); await nick.waitForTimeout(250);
  ok((await nick.locator('.log__row.is-open').count()) === 0, 'the keyboard folds them too');
}
await go(gorza, '/notices', 700); await gorza.getByRole('tab', { name: 'Change log' }).click(); await gorza.waitForTimeout(400);
ok((await gorza.locator('.log__row').count()) === 2 && !(await has(gorza, 'button', 'Add an entry')) && !(await has(gorza, 'button', 'Edit')), 'the Chieftain reads the change log but cannot edit it');

console.log('mine deals');
await go(gorza, '/mine', 700);
ok((await gorza.textContent('.page__body')).includes('No deals are on record'), 'the mine screen starts blank');
await gorza.getByRole('button', { name: 'Add a deal' }).click(); await gorza.getByLabel('Title').fill('Iron for Riften'); await gorza.getByLabel('Text').fill('Forty ingots a week.');
await gorza.getByRole('button', { name: 'Post deal' }).click(); await gorza.waitForTimeout(600);
await go(velyn, '/mine', 700);
ok((await velyn.locator('.paper').count()) === 1 && !(await has(velyn, 'button', 'Add a deal')), 'an Ally reads deals but cannot add them');
const yatul = await user('yatul');
await gorza.context().close();

console.log('expansion goals');
const sharn = await user('sharn'); await go(sharn, '/expansion', 900); await sharn.waitForSelector('.stage--total', { timeout: 10000 }).catch(() => undefined);
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
await go(yatul, '/expansion', 900);
ok((await yatul.locator('.res__input').count()) > 0 && await has(yatul, 'button', 'Add a stage'), "the Left Tusk keeps the goals too: every one of the clan's officers does");
{ // stages fold: only the stage being worked on starts open
  const state = async (p) => p.locator('.stage').evaluateAll((els) => els.map((e) => (e.classList.contains('is-open') ? 'open' : 'shut') + (e.querySelector('.panel__body') ? '+body' : '')));
  ok((await state(ugak)).join() === 'open+body,shut,shut,shut,shut,open+body', 'the first unfinished stage is open, later stages are folded, the total is open', (await state(ugak)).join());
  ok((await ugak.locator('.stage.is-shut .stagebar').count()) === 4, 'a folded stage still shows its progress bar');
  await ugak.getByRole('button', { name: 'Stage 3: Cooking Hut' }).click(); await ugak.waitForTimeout(200);
  ok((await state(ugak))[2] === 'open+body' && (await ugak.getByRole('button', { name: 'Stage 3: Cooking Hut' }).getAttribute('aria-expanded')) === 'true', 'pressing a stage opens it');
  await ugak.getByRole('button', { name: 'Stage 1: Wall Upgrade & Extension' }).click(); await ugak.waitForTimeout(200);
  ok((await state(ugak))[0] === 'shut', 'and pressing it again folds it');
  // once a stage is gathered in full it folds, and the next one opens
  const before = (await t.backend.raw.query(`select id, have from public.expansion_resources r where stage_id = (select id from public.expansion_stages where sort = 1 and clan = 'black_tusks')`)).rows;
  await t.backend.raw.query(`update public.expansion_resources set have = goal where stage_id = (select id from public.expansion_stages where sort = 1 and clan = 'black_tusks')`);
  await go(ugak, '/expansion', 900); await ugak.waitForSelector('.stage--total');
  ok((await state(ugak)).join() === 'shut,open+body,shut,shut,shut,open+body' && (await ugak.locator('.stage').first().textContent()).includes('Ready to build'),
    'a completed stage is folded by default and the next upcoming stage is open', (await state(ugak)).join());
  for (const r of before) await t.backend.raw.query(`update public.expansion_resources set have = $1 where id = $2`, [r.have, r.id]);
}
await sharn.context().close(); await go(yatul, '/code', 300);

console.log('roles');
{
  await go(nick, '/roles', 800); await nick.waitForSelector('.roles__row');
  const roleRow = async (page, name) => (await page.locator('.roles__row', { hasText: name }).first().textContent()).replace(/\s+/g, ' ');
  ok((await nick.locator('.page__title').textContent()) === 'Roles' && (await nick.locator('.roles').first().locator('.roles__row').count()) === 11 && !(await nick.textContent('.roles')).includes('Daedric'),
    'Roles explains each of the eleven tags, and Daedric is not among them');
  ok((await nick.locator('.roles').nth(1).locator('.pennant').allTextContents()).join('|') === 'The Black Tusks Clan|The Scorned Clan' && (await nick.locator('.roles').nth(1).locator('button').count()) === 0,
    'and, apart from them, the two clan tags');
  ok((await nick.locator('.roles__row .tag').allTextContents()).join('|') === 'Chieftain|Right Tusk|Left Tusk|Wise Woman|Forgemaster|Blooded|Blood-Kin|Kinsmen|Un-Blooded|Ally|Deceased', 'in standing order', (await nick.locator('.roles__row .tag').allTextContents()).join('|'));
  ok((await roleRow(nick, 'Blooded')).includes('Sworn and proven.'), 'each starts with a short description');
  await nick.getByRole('button', { name: 'Edit Blooded' }).click(); await nick.waitForSelector('.modal');
  ok((await nick.getByLabel('Description').inputValue()) === 'Sworn and proven.' && !(await has(nick, 'button', 'Use the original')), 'an officer edits a description starting from what is shown');
  await nick.getByLabel('Description').fill('Sworn to the clan and proven in battle.'); await nick.getByRole('button', { name: 'Save', exact: true }).click();
  await nick.waitForFunction(() => !document.querySelector('.modal')); await nick.waitForTimeout(400);
  ok((await roleRow(nick, 'Blooded')).includes('Sworn to the clan and proven in battle.'), 'the new description shows at once', await roleRow(nick, 'Blooded'));
  await go(ugak, '/roles', 800); await ugak.waitForSelector('.roles__row');
  ok((await roleRow(ugak, 'Blooded')).includes('Sworn to the clan and proven in battle.') && (await ugak.locator('.roles__row button').count()) === 0, 'every member reads the clan\'s wording, and only officers can edit it');
  await nick.getByRole('button', { name: 'Edit Blooded' }).click(); await nick.waitForSelector('.modal');
  await nick.getByRole('button', { name: 'Use the original' }).click(); await nick.waitForFunction(() => !document.querySelector('.modal')); await nick.waitForTimeout(400);
  ok((await roleRow(nick, 'Blooded')).includes('Sworn and proven.'), 'an officer can hand a description back to the original');
  // the fallen, as a plain member sees them
  await go(ugak, '/deceased', 900); await ugak.waitForSelector('.roster__row');
  await ugak.getByText('Durak Iron-Jaw').click(); await ugak.waitForSelector('.modal');
  ok((await ugak.textContent('.modal')).includes('Fell holding the gate against a giant.') && (await ugak.textContent('.modal')).includes('Durak stood where others ran') && !(await has(ugak, 'button', 'Edit')), 'a member reads a fallen card but cannot edit it');
  await ugak.getByRole('button', { name: 'Pay Respect' }).click(); await ugak.waitForTimeout(250);
  ok((await ugak.locator('.modal .burst').count()) === 1, 'and can pay their respects');
  await ugak.locator('.modal').getByRole('button', { name: 'Close' }).click();
}

console.log('mining map');
await go(ugak, '/map', 2500);
ok((await ugak.title()) === 'Mining Map | Black Tusk Companion', 'the map names its browser tab', await ugak.title());
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
  // The map picture (7936 x 6272) has a flat blue strip round it: 192px on the left, 64 on top, 128 on the right, 188 below.
  // Pull hard towards each side and ask the map which part of the picture is on screen.
  const view = () => ugak.evaluate(() => document.querySelector('.map').dataset.view.split(',').map(Number));
  for (const [side, dx, dy, inside] of [['left', 900, 0, (v) => v[0] >= 194], ['right', -900, 0, (v) => v[2] <= 7936 - 130], ['bottom', 0, -700, (v) => v[3] <= 6272 - 190], ['top', 0, 700, (v) => v[1] >= 66]]) {
    for (let i = 0; i < 3; i++) {
      await ugak.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await ugak.mouse.down();
      await ugak.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 }); await ugak.mouse.up(); await ugak.waitForTimeout(350);
    }
    await ugak.waitForTimeout(600);
    const v = await view();
    ok(inside(v), `pulled to the ${side} edge, the blue strip round the map picture stays off screen`, v.join(','));
  }
  ok(await ugak.evaluate(() => getComputedStyle(document.querySelector('.map')).backgroundColor) === 'rgb(0, 0, 0)', 'behind the map is black');
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

console.log('discord status');
{
  // Discord's widget names members by their nickname in the clan server. A member whose name here is the
  // same needs nothing on their profile; anyone else is matched by the Discord name they enter.
  await t.backend.seedUser('snagga', 'Snagga the Quiet', ['kinsmen']);        // a member who never opens the app
  t.backend.discordStub.status = 200;
  t.backend.discordStub.body = { name: 'The Black Tusks', presence_count: 3, members: [
    { id: '0', username: 'GORZA GRA-LARGASH', discriminator: '0000', status: 'online', game: { name: 'The Elder Scrolls V: Skyrim Special Edition' } },
    { id: '1', username: 'Velyn of the Rift', discriminator: '0000', status: 'idle' },
    { id: '2', username: 'Some Stranger', discriminator: '0000', status: 'online' }] };
  await go(nick, '/members', 900);
  await nick.getByRole('button', { name: 'Discord link' }).click();
  ok((await nick.locator('.modal .steps').textContent()).includes('Engagement'), 'the Discord link steps point at Server Settings, Engagement');
  await nick.getByLabel('The Black Tusks: Server ID').fill('1541830682387685516'); await nick.locator('.modal').getByRole('button', { name: 'Save' }).click();
  await nick.waitForSelector('.modal .note'); await nick.waitForTimeout(900);
  const told = (await nick.locator('.modal').textContent()).replace(/\s+/g, ' ');
  ok(told.includes('Connected to The Black Tusks') && told.includes('matching no member here: Some Stranger'), 'the Forgemaster is told who is online in Discord but matches no member', told.slice(-260));
  await nick.locator('.modal').getByRole('button', { name: 'Close' }).click(); await nick.waitForTimeout(300);
  const row = async (name) => (await nick.locator('.roster__row', { hasText: name }).first().textContent()).replace(/\s+/g, ' ');
  ok((await row('Gorza gra-Largash')).includes('In the realm'), 'a member is found in Discord by their own name, with no Discord name on their profile', await row('Gorza gra-Largash'));
  ok((await row('Velyn of the Rift')).includes('In Discord'), 'someone online but not in the game reads as in Discord');
  // Snagga has never signed in, so she is neither in Discord nor on the app
  ok((await row('Snagga the Quiet')).includes('Offline') && !(await nick.locator('.roster').textContent()).includes('Not linked'), 'everyone else reads as offline; nobody is "not linked" any more', await row('Snagga the Quiet'));
  ok((await nick.locator('.roster__row', { hasText: 'Durak' }).count()) === 0, 'the fallen are not on the Members list, online or not');
  ok((await nick.locator('.page__sub').textContent()).includes('1 in the realm now'), 'the heading counts who is in the realm');

  // someone in Discord playing another game is simply "In Discord"; who is about comes first; and the app itself is seen
  t.backend.discordStub.body.members[1] = { id: '1', username: 'Velyn of the Rift', discriminator: '0000', status: 'online', game: { name: 'Rocket League' } };
  const sharn = await user('sharn'); await sharn.waitForTimeout(600);                 // Sharn opens the app
  await go(nick, '/', 200); await go(nick, '/members', 1400);
  await nick.waitForFunction(() => document.querySelectorAll('.presence--app').length >= 2, null, { timeout: 50000 }).catch(() => undefined);
  const order = (await nick.locator('.roster__row').evaluateAll((rows) => rows.map((r) => r.querySelector('.roster__name').textContent.replace(/\s*\(you\)/, '') + '=' + [...r.querySelectorAll('.presence')].map((x) => x.textContent).join('+'))));
  ok(order[0].startsWith('Gorza gra-Largash=In the realm'), 'whoever is in the realm heads the list', order.join(' | '));
  const lastOn = Math.max(...order.map((o, i) => (/In the realm|In Discord|On the app/.test(o) ? i : -1))), firstOff = order.findIndex((o) => !/In the realm|In Discord|On the app/.test(o));
  ok(firstOff < 0 || lastOn < firstOff, 'everyone who is about comes before everyone who is not', order.join(' | '));
  ok(order.some((o) => /^Nick=.*On the app/.test(o)) && order.some((o) => /^Sharn=.*On the app/.test(o)) && !order.some((o) => /^Snagga the Quiet=.*On the app/.test(o)), 'members with the app open are marked "On the app", and one who has never opened it is not', order.join(' | '));
  ok(/on the app/.test(await nick.locator('.page__sub').textContent()), 'and the heading counts them', await nick.locator('.page__sub').textContent());
  await nick.locator('.roster__row', { hasText: 'Velyn of the Rift' }).click(); await nick.waitForSelector('.modal');
  const seen = (await nick.locator('.modal').textContent());
  ok(seen.includes('In Discord') && !seen.includes('Rocket League'), 'a member\'s card says In Discord without naming a game that is not Skyrim', seen.slice(0, 160));
  await nick.locator('.modal').getByRole('button', { name: 'Close' }).click();
  await sharn.getByRole('button', { name: 'Sign Out' }).click(); await sharn.waitForTimeout(700); await sharn.context().close();
  await go(nick, '/', 200); await go(nick, '/members', 1400);
  ok(!(await nick.locator('.roster__row', { hasText: 'Sharn' }).textContent()).includes('On the app'), 'signing out takes a member off the list at once');
}

console.log('pop-ups');
{ // an officer's edit form is taller than a small screen: it must start below the top and scroll all the way
  await nick.setViewportSize({ width: 390, height: 620 });
  await go(nick, '/members', 900);
  await nick.locator('.roster__row', { hasText: 'Ugak' }).click(); await nick.locator('.modal').getByRole('button', { name: 'Edit', exact: true }).click(); await nick.waitForTimeout(400);
  const m = await nick.evaluate(() => { const o = document.querySelector('.modal'), b = o.querySelector('.modal__box'); o.scrollTop = 0; const top = b.getBoundingClientRect().top; o.scrollTop = o.scrollHeight; const bottom = b.getBoundingClientRect().bottom;
    return { top, bottom, tall: b.getBoundingClientRect().height > window.innerHeight, h: window.innerHeight, lock: getComputedStyle(document.documentElement).overflowY }; });
  ok(m.tall && m.top >= 12, 'a pop-up taller than the screen starts below the top of the screen, not above it', JSON.stringify(m));
  ok(m.bottom <= m.h - 12 + 1, 'and scrolls all the way to its last button', JSON.stringify(m));
  ok(m.lock === 'hidden', 'while it is open the page behind does not scroll');
  await nick.evaluate(() => { document.querySelector('.modal').scrollTop = 0; });
  await nick.keyboard.press('Escape'); await nick.waitForTimeout(300);
  ok(await nick.evaluate(() => !document.querySelector('.modal') && !document.documentElement.classList.contains('has-modal')), 'closing it lets the page scroll again');
  await nick.setViewportSize({ width: 1440, height: 900 });
}

console.log('pricing ledger');
await velyn.context().close(); await go(nick, '/code', 300);
{ // the recipes file fails to arrive: the card says so, rather than calling a made item "found", and tries again
  const p = await user('velyn', 'TestPass123', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  let blocked = true;
  await p.route(/\/data\/details\.json/, (route) => (blocked ? route.abort() : route.continue()));
  await go(p, '/ledger', 1500); await p.getByLabel('Filter by name').fill('warchief heavy battlecrown'); await p.waitForTimeout(500);
  await p.locator('.lrow').first().click(); await p.waitForSelector('.icard__name');
  await p.waitForSelector('.icard__missing', { timeout: 15000 }).catch(() => undefined);
  const card = (await p.locator('.icard').textContent()).replace(/\s+/g, ' ');
  ok(card.includes('did not load') && !card.includes('Not craftable') && !/How to get it\s*(Found|Made)/.test(card), 'without the recipes the card says they did not load, and does not call the item found', card.slice(0, 300));
  blocked = false; await p.getByRole('button', { name: 'Try again' }).click();
  await p.waitForFunction(() => /Made at a forge/.test(document.querySelector('.icard')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => undefined);
  const after = (await p.locator('.icard').textContent()).replace(/\s+/g, ' ');
  ok(after.includes('Made at a forge') && after.includes('Smelts down into') && /How to get it\s*Made/.test(after), 'Try again brings the recipe back: Made, and what it smelts into', after.slice(0, 300));
  await p.context().close();
}
await go(ugak, '/ledger', 1800);
ok((await ugak.title()) === 'Pricing Ledger | Black Tusk Companion', 'the ledger names its browser tab', await ugak.title());
ok(Number((await ugak.locator('.ledger__count b').first().textContent()).replace(/,/g, '')) > 3500, 'the ledger lists thousands of items');
ok(!(await ugak.locator('.ledger').textContent()).includes('Keys'), 'there is no Keys section');
{ // the Misc section after the clan's trims
  await ugak.getByRole('button', { name: 'Misc', exact: true }).click(); await ugak.waitForTimeout(500);
  const types = await ugak.getByLabel('Type', { exact: true }).locator('option').allTextContents();
  ok(!types.includes('Clutter') && !types.includes('Dragon Claw') && !types.includes('Misc') && types.includes('Ingot') && types.includes('Tool'), 'Misc has no Clutter, Dragon Claw or untyped Misc items', types.join(','));
  await ugak.getByLabel('Type', { exact: true }).selectOption('Tool'); await ugak.waitForTimeout(400);
  const tools = (await ugak.locator('.lrow .lc-name').allTextContents()).map((x) => x.trim()).sort();
  ok(tools.join('|') === 'Linen Wrap|Lockpick', 'the only tools left are the lockpick and the linen wrap', tools.join('|'));
  await ugak.getByLabel('Type', { exact: true }).selectOption(''); await ugak.getByLabel('Filter by name').fill('do not delete'); await ugak.waitForTimeout(400);
  ok((await ugak.locator('.lrow').count()) === 0, '"Do Not Delete" is gone');
  await ugak.getByRole('button', { name: 'All', exact: true }).click(); await ugak.getByLabel('Filter by name').fill('elven boots'); await ugak.waitForTimeout(400);
  await ugak.locator('.lrow', { hasText: 'Elven Boots' }).first().click();
  const pic = await ugak.waitForSelector('.icard__view img.is-render', { timeout: 8000 }).catch(() => null);
  ok(pic && await ugak.waitForFunction(() => { const i = document.querySelector('.icard__view img'); return i && i.complete && i.naturalWidth === 384; }, null, { timeout: 8000 }).then(() => true, () => false),
    'an item shows the picture made from its game model');
  ok(await ugak.evaluate(() => { const v = document.querySelector('.icard__view').getBoundingClientRect(), i = document.querySelector('.icard__view img').getBoundingClientRect(); return i.top >= v.top - 1 && i.bottom <= v.bottom + 1 && i.height > 120; }),
    'and the picture stays inside its frame, above the item card');
}
{ // later trims: enchanted variants, improvement notes, the Blacksmith's potions and the dragon priest masks
  ok(!(await ugak.locator('.lfilters').textContent()).includes('Enchanted'), 'there is no "Enchanted variants" switch');
  const named = async (q) => { await ugak.getByLabel('Filter by name').fill(q); await ugak.waitForTimeout(400); return (await ugak.locator('.lrow .lc-name').allTextContents()).map((x) => x.replace('★', '').trim()); };
  ok((await named('of embers')).length === 0, 'generic enchanted variants are gone', (await named('of embers')).join('|'));
  const smith = await named("blacksmith's");
  ok(smith.length > 0 && !smith.some((n) => /Potion|Draught|Philter|Elixir/.test(n)), "the Blacksmith's potions are gone", smith.join('|'));
  ok(!(await named('krosis')).includes('Krosis') && (await named('wooden mask')).length === 0 && !(await named('miraak')).includes('Miraak'), 'the dragon priest masks are gone');
  const worn = [...await named('krosis'), ...await named("miraak's"), ...await named("vahlok's")].filter((n) => /(Armor|Robes|Boots|Gloves|Gauntlets|Bracers)$/.test(n));
  ok(worn.length === 0, 'and so are the armor sets named after the priests', worn.join('|'));
  ok((await named('spider')).every((n) => !/Spider$/.test(n) || /Tome/.test(n)) && !(await named('spider')).includes('Jumping Flame Spider'), 'the spiders are gone from the scrolls', (await named('spider')).join('|'));
  ok((await named('glacier water')).length + (await named('orc skull')).length + (await named('snowelf')).length + (await named('windhelm homebrew')).length === 0, 'the items that had no picture are gone');
  await named('daedric nodachi'); await ugak.locator('.lrow', { hasText: 'Daedric Nodachi' }).first().click(); await ugak.waitForTimeout(500);
  ok(!/Improved at|grindstone|workbench/i.test(await ugak.locator('.ledger__card').textContent()), 'no weapon or armor improvement note on an item');
  ok(await ugak.evaluate(() => { const p = document.querySelector('.ledger__card').getBoundingClientRect(), c = document.querySelector('.icard__swipe').getBoundingClientRect(); return c.height < p.height && Math.abs((c.top + c.bottom) / 2 - (p.top + p.bottom) / 2) < 16; }),
    'on a desktop the open item sits in the middle of its panel');
  ok(/\.webp\?v=[0-9a-f]{6}$/.test(await ugak.locator('.icard__view img').getAttribute('src')), "a picture's address carries a stamp of its contents", await ugak.locator('.icard__view img').getAttribute('src'));
}
await ugak.getByLabel('Filter by name').fill('iron ingot'); await ugak.waitForTimeout(400); await ugak.locator('.lrow', { hasText: 'Iron Ingot' }).first().click(); await ugak.waitForTimeout(500);
const card = async (p) => (await p.locator('.ledger__card').textContent()).replace(/\s+/g, ' ');
ok((await card(ugak)).includes('Unknown tier') && (await card(ugak)).includes('Price unknown'), 'items start at unknown tier and unknown price');
ok((await card(ugak)).includes('Made at a smelter from 1 Iron Ore, 1 Poor Charcoal'), 'the server\'s own recipe is shown', (await card(ugak)).slice(0, 300));
ok(!(await has(ugak, 'button', 'Edit')) && !(await has(ugak, 'button', 'Add an item')), 'members cannot edit the ledger');
await go(yatul, '/ledger', 1800);
await yatul.getByLabel('Filter by name').fill('iron ingot'); await yatul.waitForTimeout(400); await yatul.locator('.lrow', { hasText: 'Iron Ingot' }).first().click(); await yatul.getByRole('button', { name: 'Edit' }).click();
await yatul.locator('.modal').getByLabel('Tier').selectOption('2'); await yatul.locator('.modal').getByLabel('Clan price').fill('12');
const png = await sharp({ create: { width: 240, height: 200, channels: 3, background: '#f4f4f4' } }).composite([{ input: await sharp({ create: { width: 120, height: 90, channels: 3, background: '#7a3b22' } }).png().toBuffer(), left: 60, top: 55 }]).png().toBuffer();
await yatul.getByLabel('Choose a picture').setInputFiles({ name: 'ingot.png', mimeType: 'image/png', buffer: png });
await yatul.waitForFunction(() => document.querySelector('.imgedit__view img')?.src.startsWith('blob:'), null, { timeout: 8000 }); await yatul.waitForTimeout(500);
await yatul.getByRole('button', { name: 'Save', exact: true }).click(); await yatul.waitForSelector('.icard__view img:not(.is-render)', { timeout: 8000 });
ok((await card(yatul)).includes('Tier 2') && (await card(yatul)).includes('12 septims'), 'Left Tusk sets tier and price');
const px = await yatul.evaluate(async () => {
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
await yatul.context().close(); await ugak.context().close();
await go(nick, '/', 500); await nick.getByRole('button', { name: 'Sign Out' }).click(); await nick.waitForTimeout(600);
ok((await menu(nick)).join('|') === 'Sign In|Settings|Code of Mauloch', 'signing out returns to the guest menu');

console.log('phone');
await nick.context().close();
const phone = await user('ugak', 'TestPass123', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const r of ['/', '/code', '/code/tenets', '/notices', '/oath', '/members', '/deceased', '/roles', '/mine', '/expansion', '/map', '/ledger']) {
  await go(phone, r, r === '/map' ? 2200 : 900);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, `no sideways scroll on a phone at ${r}`, String(over));
}

{ // on a phone the open card can be swiped (or stepped with its arrows) to the next and the previous item
  await go(phone, '/ledger', 1500);
  await phone.getByLabel('Filter by name').fill('iron'); await phone.waitForTimeout(500);
  const names = (await phone.locator('.lrow .lc-name').allTextContents()).map((x) => x.replace('★', '').trim());
  await phone.locator('.lrow').first().click(); await phone.waitForSelector('.icard__name');
  const name = async () => (await phone.locator('.icard__name').textContent()).trim();
  const pager = async () => (await phone.locator('.icard__pager span').textContent()).trim();
  const swipe = (dx, dy = 0) => phone.evaluate(async ({ dx, dy }) => {
    const el = document.querySelector('.ledger__card'); const b = el.getBoundingClientRect(); const x0 = b.left + b.width / 2, y0 = b.top + 160;
    const fire = (type, x, y) => { const tp = new Touch({ identifier: 1, target: el, clientX: x, clientY: y }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [tp], targetTouches: type === 'touchend' ? [] : [tp], changedTouches: [tp] })); };
    fire('touchstart', x0, y0);
    for (let i = 1; i <= 8; i++) { fire('touchmove', x0 + (dx * i) / 8, y0 + (dy * i) / 8); await new Promise((r) => setTimeout(r, 16)); }
    fire('touchend', x0 + dx, y0 + dy);
  }, { dx, dy });
  ok((await name()) === names[0] && (await pager()).startsWith('1 of '), 'the open card says where it stands in the list', `${await name()} / ${await pager()}`);
  await swipe(-190); await phone.waitForTimeout(350);
  ok((await name()) === names[1] && (await pager()).startsWith('2 of '), 'a swipe to the left brings the next item', `${await name()} (wanted ${names[1]})`);
  await swipe(190); await phone.waitForTimeout(350);
  ok((await name()) === names[0], 'a swipe to the right goes back to the one before', await name());
  await swipe(190); await phone.waitForTimeout(350);
  ok((await name()) === names[0], 'there is nothing before the first item, so the card stays');
  await swipe(-30, 220); await phone.waitForTimeout(300);
  ok((await name()) === names[0], 'scrolling the card up and down does not change the item');
  await phone.getByRole('button', { name: 'Next item' }).click(); await phone.waitForTimeout(300);
  ok((await name()) === names[1], 'the arrow does the same as the swipe');
  ok(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1), 'and nothing is pushed off the side of the screen');
  await phone.getByRole('button', { name: 'Back to list' }).click(); await phone.waitForTimeout(300);
  ok(await phone.locator('.lrow.is-on').first().textContent().then((x) => x.includes(names[1])), 'back at the list, the item last looked at is the one marked');
}

const real = t.errors.filter((e) => !/401|403|400 \(Bad Request\)/.test(e));
ok(real.length === 0, 'no script errors in the browser', real.slice(0, 5).join(' || '));
console.log(`\n${pass} passed, ${fail} failed`);
await t.stop(); process.exit(fail ? 1 : 0);
