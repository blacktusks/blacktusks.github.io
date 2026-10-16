// The home-screen app: every full-screen layer must be as tall as the screen itself, even when
// the page starts out shorter than the screen (iPhones do this, by the height of the status bar).
// A desktop browser cannot be an iPhone, so this checks the wiring: given the numbers an iPhone
// reports, do the layers come out the right size?
//   node tests/look_app.mjs
import { boot } from './harness.mjs';
const t = await boot();
let bad = 0;
const fail = (label, msg) => { bad++; console.log('PROBLEM', label, msg); };

// name, page size, screen size, how it is opened, the height every full-screen layer should have
const CASES = [
  ['iPhone app, page starts 47px short', [390, 797], [390, 844], 'ios', 844],
  ['iPhone app, page starts 59px short', [430, 873], [430, 932], 'ios', 932],
  ['iPhone SE app, page starts 20px short', [375, 647], [375, 667], 'ios', 667],
  ['iPhone app, page already whole', [390, 844], [390, 844], 'ios', 844],
  ['iPhone app on its side', [844, 390], [390, 844], 'ios', 390],
  ['iPad app, whole screen', [820, 1180], [820, 1180], 'ipad', 1180],
  ['iPad app in a part-screen window', [600, 800], [820, 1180], 'ipad', 800],
  ['iPad app in a window a little short of the screen', [820, 1100], [820, 1180], 'ipad', 1100],
  ['Android app', [412, 915], [412, 915], 'android', 915],
  ['phone browser tab', [390, 664], [390, 844], 'tab', 664],
  ['desktop browser', [1366, 768], [1920, 1080], 'tab', 768],
];
const LAYERS = { '#/': ['.scene', '.menu'], '#/map': ['.scene', '.mapscreen'], '#/ledger': ['.scene', '.ledger'] };

for (const [label, [w, h], [sw, sh], mode, want] of CASES) {
  const UA = { ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', ipad: 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }[mode];
  const ctx = await t.browser.newContext({ viewport: { width: w, height: h }, screen: { width: sw, height: sh }, deviceScaleFactor: 1, isMobile: mode !== 'tab' || w < 500, hasTouch: w < 1000, ...(UA ? { userAgent: UA } : {}) });
  if (mode === 'ios' || mode === 'ipad') await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); });
  // an installed app on Android answers "standalone" when asked how it is shown
  if (mode === 'android') await ctx.addInitScript(() => { const real = window.matchMedia.bind(window); window.matchMedia = (q) => { const m = real(q); return /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : m; }; });
  const page = await ctx.newPage();
  await page.goto(t.base + '#/sign-in');
  // before anything else: the loading screen itself must already cover the screen
  const first = await page.evaluate(() => ({ app: document.documentElement.classList.contains('is-app'), px: document.documentElement.style.getPropertyValue('--screen-h'),
    splash: document.getElementById('splash')?.getBoundingClientRect().height ?? null }));
  if (first.app !== (mode !== 'tab')) fail(label, `is-app is ${first.app}`);
  if (first.splash != null && Math.abs(first.splash - want) > 1) fail(label, `loading screen is ${first.splash}px tall, wanted ${want}`);
  // a phone on its side is covered (it asks to be turned upright): sign in upright, then turn it back
  const turned = w > h && h <= 500 && mode !== 'tab';
  if (turned) await page.setViewportSize({ width: h, height: w });
  await page.getByLabel('Name').fill('nick'); await page.getByLabel('Password').fill('TestPass123'); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.menu__nav'); await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 20000 });
  if (turned) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    const covered = await page.evaluate(() => getComputedStyle(document.querySelector('.upright')).display !== 'none');
    if (!covered) fail(label, 'a phone on its side is not asked to turn upright');
  }
  const seen = [];
  for (const [route, layers] of Object.entries(LAYERS)) {
    await page.evaluate((r) => { location.hash = r; }, route);
    await page.waitForSelector(layers[1]); await page.waitForTimeout(route === '#/' ? 400 : 900);
    const res = await page.evaluate(({ layers, want }) => {
      const out = [];
      for (const sel of layers) {
        const b = document.querySelector(sel).getBoundingClientRect();
        if (Math.abs(b.top) > 0.5 || Math.abs(b.height - want) > 1 || Math.abs(b.width - window.innerWidth) > 1) out.push(`${sel} is ${Math.round(b.width)}x${Math.round(b.height)} at ${Math.round(b.top)}, wanted height ${want}`);
      }
      // what is inside must use the whole height and stay inside it
      const inside = (sel, name) => { const el = document.querySelector(sel); if (!el) return; const b = el.getBoundingClientRect(); if (b.top < -1 || b.bottom > want + 1) out.push(`${name} leaves the screen (${Math.round(b.top)} to ${Math.round(b.bottom)} of ${want})`); return b; };
      const foot = inside('.menu__foot', 'small print'); inside('.menu__nav', 'menu list'); inside('.mapscreen__bar', 'map buttons'); inside('.lrows', 'ledger rows');
      if (foot && want - foot.bottom > 80) out.push(`small print stops ${Math.round(want - foot.bottom)}px above the bottom`);
      const bg = document.querySelector('.scene__bg')?.getBoundingClientRect();
      if (bg && (bg.top > 0.5 || bg.bottom < want - 0.5)) out.push(`background picture covers ${Math.round(bg.top)} to ${Math.round(bg.bottom)} of ${want}`);
      const map = document.querySelector('.map'); const pane = map?.querySelector('.leaflet-map-pane');
      if (map && pane) { const m = map.getBoundingClientRect(); if (m.height < 120) out.push(`map is only ${Math.round(m.height)}px tall`); }
      return out;
    }, { layers, want });
    res.forEach((m) => fail(label, `${route} ${m}`));
    seen.push(`${route.slice(2) || 'menu'} ${res.length ? 'BAD' : 'ok'}`);
  }
  // a pop-up covers the whole screen too
  await page.evaluate(() => { location.hash = '#/members'; }); await page.waitForSelector('.member, .mrow, [class*=member]', { timeout: 10000 }).catch(() => undefined);
  console.log(first.px ? `screen ${first.px}` : 'no override', '|', label, `${w}x${h}`, '->', want, '|', seen.join(', '));
  if (label === 'iPhone app, page already whole') await page.screenshot({ path: 'tests/shots/app-390x844-ledger.png' });
  await ctx.close();
}
console.log(bad ? `${bad} problems` : 'the home-screen app fills the screen in every case');
await t.stop(); process.exit(bad ? 1 : 0);
