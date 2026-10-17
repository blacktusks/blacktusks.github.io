// The switch between the clans as it plays: the signed-out turn and Visit, on a phone and a computer. The browser
// streams its frames as they are drawn, so every moment of the two-second swap is seen. Frames go to
// tests/shots/swap-<size>-<which>-NN.jpg, about eight a second.
//   node tests/look_swap.mjs
import fs from 'node:fs';
import path from 'node:path';
import { boot } from './harness.mjs';
const t = await boot();
const SHOTS = path.resolve('tests/shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sizes = { phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1600, height: 900 } } };

/** Streams the page's frames for `ms` after `start()`, keeping about eight a second. */
async function film(p, name, start, ms = 2600) {
  const cdp = await p.context().newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push({ at: Date.now(), data: f.data }); void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
  await p.waitForTimeout(300);
  const t0 = Date.now(); await start();
  await p.waitForTimeout(ms);
  await cdp.send('Page.stopScreencast');
  let n = 0, next = t0 - 120;
  for (const f of frames) if (f.at >= next) { fs.writeFileSync(path.join(SHOTS, `swap-${name}-${String(n++).padStart(2, '0')}.jpg`), Buffer.from(f.data, 'base64')); next = f.at + 120; }
  return n;
}

for (const [name, opts] of Object.entries(sizes)) {
  // signed out: the menu turns from the Black Tusks to the Scorned nine seconds after it opens
  const g = await t.open(opts);
  await g.waitForTimeout(7800);
  console.log(name, 'guest', await film(g, `${name}-guest`, () => g.waitForSelector('.menu.is-fog-out', { timeout: 6000 })));
  await g.context().close();
  // signed in: Visit the Scorned
  const p = await t.open(opts);
  await t.signIn(p, 'nick'); await p.waitForTimeout(3000);
  console.log(name, 'visit', await film(p, `${name}-visit`, () => p.getByRole('button', { name: 'Visit The Scorned' }).click()));
  await p.context().close();
}
console.log(t.errors.length ? t.errors.join('\n') : 'no page errors');
await t.stop();
