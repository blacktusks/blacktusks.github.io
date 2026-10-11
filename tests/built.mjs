// Builds the production bundle and checks it works when served from a
// sub-path, the way GitHub Pages serves a project site.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import * as backend from '../dev/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'node_modules/.cache/dist-test');
const info = await backend.start();
execFileSync('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_SUPABASE_URL: info.url, VITE_SUPABASE_ANON_KEY: info.anonKey } });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
const PREFIX = '/black-tusk-companion/';
const missing = [];
const site = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(PREFIX)) { missing.push(url.pathname); res.writeHead(404); return res.end('outside the site'); }
  let rel = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
  const file = path.join(OUT, rel);
  if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { missing.push(url.pathname); res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => site.listen(4188, ok));

let pass = 0, fail = 0; const ok = (c, n, x = '') => { c ? pass++ : (fail++, console.log('  FAIL', n, x)); };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const base = 'http://localhost:4188' + PREFIX;
await page.goto(base); await page.waitForSelector('.menu__nav');
ok((await page.locator('.menu__item').allTextContents()).join('|') === 'Sign In|Code of Mauloch', 'the built app opens to the guest menu');
await page.waitForSelector('canvas.banner.is-ready', { timeout: 15000 }).then(() => ok(true, 'banner textures load from the sub-path'), () => ok(false, 'banner textures load from the sub-path'));
ok(await page.evaluate(() => { const i = document.querySelector('.scene__bg'); return i.complete && i.naturalWidth > 0; }), 'background image loads');
ok(await page.evaluate(() => getComputedStyle(document.querySelector('.scene__smoke i')).backgroundImage.includes('smoke')), 'smoke texture resolves');
const manifest = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return r.ok ? r.json() : null; });
ok(manifest?.display === 'standalone' && manifest.icons?.length === 3 && manifest.start_url === '.', 'web app manifest is served and set to standalone', JSON.stringify(manifest)?.slice(0, 200));
ok(await page.evaluate(() => !!document.querySelector('link[rel=apple-touch-icon]') && document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content === 'yes'), 'iOS home-screen tags are present');
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.scope; });
ok(sw.endsWith(PREFIX), 'the service worker registers for the sub-path', sw);
ok(await page.evaluate(() => document.fonts.ready.then(() => document.fonts.check('300 20px "Antonio Variable"'))), 'the menu font loads');
await page.goto(base + '#/sign-in'); await page.getByLabel('Name').fill('nick'); await page.getByLabel('Password').fill('TestPass123'); await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('.menu__nav'); ok((await page.locator('.menu__item').count()) === 12, 'sign-in works in the built app');
await page.goto(base + '#/map'); await page.waitForTimeout(2500); ok((await page.locator('.leaflet-tile-loaded').count()) > 3, 'map tiles load from the sub-path');
await page.goto(base + '#/ledger'); await page.waitForSelector('.lrow', { timeout: 10000 }); ok((await page.locator('.lrow').count()) > 5, 'the item catalog loads from the sub-path');
// offline: the shell and the lore still open
await page.goto(base); await page.waitForSelector('.menu__nav'); await page.waitForTimeout(1500);
await page.context().setOffline(true); await page.reload().catch(() => {}); 
const offline = await page.waitForSelector('.menu__nav', { timeout: 8000 }).then(() => true, () => false);
ok(offline, 'the app shell opens with no connection');
await page.context().setOffline(false);
ok(missing.filter((m) => !m.endsWith('favicon.ico')).length === 0, 'nothing is requested outside the site or missing', missing.slice(0, 6).join(', '));
ok(errors.length === 0, 'no script errors', errors.slice(0, 3).join(' | '));
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((s, d) => s + (d.isDirectory() ? size(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`build size ${(size(OUT) / 1e6).toFixed(1)} MB; scripts ${(size(path.join(OUT, 'assets')) / 1e6).toFixed(2)} MB`);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); site.close(); backend.server.close(); process.exit(fail ? 1 : 0);
