// The main menu at many screen sizes: nothing off-screen, nothing overlapping, no scrolling.
//   node tests/look_fit.mjs
import { boot } from './harness.mjs';
const t = await boot();
const SIZES = [[320, 480], [320, 568], [360, 560], [360, 640], [375, 667], [390, 664], [390, 844], [412, 915], [430, 932], [600, 960], [768, 1024], [820, 1180],
  [568, 320], [640, 300], [667, 330], [740, 360], [844, 390], [932, 430], [1024, 600], [1024, 768], [1180, 820], [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1257], [3440, 1440]];
let bad = 0;
const check = async (page, label) => page.evaluate((label) => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const vw = window.innerWidth, vh = window.innerHeight;
  const nav = r('.menu__nav'), foot = r('.menu__foot'), banner = r('.menu__banner .banner'), who = r('.menu__who');
  const out = [];
  const inside = (b, name, slack = 1) => { if (b && (b.l < -slack || b.t < -slack || b.r > vw + slack || b.b > vh + slack)) out.push(`${name} leaves the screen ${JSON.stringify(b)}`); };
  inside(nav, 'menu list'); inside(foot, 'small print');
  if (banner && (banner.t < -vh * 0.02 || banner.l < -1 || banner.r > vw + 1 || banner.b > vh * 1.03)) out.push(`banner leaves the screen ${JSON.stringify(banner)}`);
  const hit = (a, b) => a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
  if (hit(nav, foot)) out.push('menu list overlaps the small print');
  const portrait = vh > vw * 20 / 21;
  if (portrait && hit(nav, banner)) out.push('menu list overlaps the banner');
  const se = document.scrollingElement;
  if (se.scrollHeight > vh + 1 || se.scrollWidth > vw + 1) out.push(`page scrolls ${se.scrollWidth}x${se.scrollHeight}`);
  const item = document.querySelector('.menu__item:not(.menu__item--quiet)');
  const fs = item ? parseFloat(getComputedStyle(item).fontSize) : 0;
  if (fs < 14) out.push(`menu text is ${fs}px`);
  const items = [...document.querySelectorAll('.menu__item')].map((i) => i.getBoundingClientRect());
  if (items.some((b) => b.left < 0 || b.right > vw)) out.push('a menu line is cut off at the side');
  if (banner && banner.w < Math.min(vw, vh) * 0.2) out.push(`banner is tiny: ${Math.round(banner.w)}px`);
  return { label, size: `${vw}x${vh}`, font: fs, banner: banner && Math.round(banner.w), splash: !!document.getElementById('splash'), problems: out };
}, label);
for (const who of ['guest', 'member']) {
  for (const [w, h] of SIZES) {
    const ctx = await t.browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 1000 && h < 1000, hasTouch: w < 1000 });
    const page = await ctx.newPage();
    // a phone on its side is covered (it asks to be turned upright), so sign in upright and then turn it
    const turned = w > h && h <= 500 && w < 1000;
    if (who === 'member') {
      if (turned) await page.setViewportSize({ width: h, height: w });
      await page.goto(t.base + '#/sign-in'); await page.getByLabel('Name').fill('nick'); await page.getByLabel('Password').fill('TestPass123'); await page.getByRole('button', { name: 'Sign in' }).click();
      if (turned) { await page.waitForSelector('.menu__nav'); await page.setViewportSize({ width: w, height: h }); }
    }
    else await page.goto(t.base);
    await page.waitForSelector('.menu__nav'); await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const res = await check(page, who);
    // a phone on its side is asked to turn upright; nothing else is
    const sideways = w > h && h <= 500 && w < 1000;
    const cover = await page.evaluate(() => { const el = document.querySelector('.upright'); const b = el?.getBoundingClientRect();
      return el && getComputedStyle(el).display !== 'none' && b.width >= window.innerWidth - 1 && b.height >= window.innerHeight - 1 && /upright/i.test(el.textContent); });
    if (!!cover !== sideways) res.problems.push(sideways ? 'a phone on its side is not asked to turn upright' : 'the turn-upright cover shows where it should not');
    if (res.problems.length) { bad++; console.log('PROBLEM', JSON.stringify(res)); } else console.log('ok', who, res.size, 'text', res.font + 'px', 'banner', res.banner + 'px');
    if (who === 'member' && [[320, 480], [360, 640], [390, 844], [568, 320], [844, 390], [1024, 768], [1600, 900]].some(([a, b]) => a === w && b === h)) await page.screenshot({ path: `tests/shots/fit-${w}x${h}.png` });
    await ctx.close();
  }
}
console.log(bad ? `${bad} sizes with problems` : 'every size fits');
await t.stop(); process.exit(bad ? 1 : 0);
