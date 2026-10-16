// A phone turned on its side: the cover asking for it to be turned upright.   node tests/look_upright.mjs
import { boot } from './harness.mjs';
const t = await boot();
const page = await t.open({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(t.base); await page.waitForTimeout(1500); await t.shot(page, 'upright-cover');
await t.stop(); process.exit(0);
