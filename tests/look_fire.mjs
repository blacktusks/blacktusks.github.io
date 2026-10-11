// Screenshots of the campfire for judging it by eye: node tests/look_fire.mjs
import { boot } from './harness.mjs';
const t = await boot();
const d = await t.open({ viewport: { width: 1920, height: 1080 } });
await d.waitForSelector('canvas.banner.is-ready', { timeout: 15000 }).catch(() => console.log('banner not ready'));
await d.waitForTimeout(3500);
await t.shot(d, 'fire-full-desktop');
const box = await d.locator('.scene__firelight').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height * 0.44;
for (let i = 0; i < 4; i++) {
  await d.screenshot({ path: `tests/shots/fire-close-${i}.png`, clip: { x: cx - 240, y: cy - 190, width: 480, height: 330 } });
  await d.waitForTimeout(420);
}
const m = await t.open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.waitForTimeout(3500);
await t.shot(m, 'fire-full-phone');
console.log('errors:', t.errors);
await t.stop(); process.exit(0);
