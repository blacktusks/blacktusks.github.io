// Boots the local backend and the app, and hands back a browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import * as backend from '../dev/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function boot({ port = 5179 } = {}) {
  const info = await backend.start();
  process.env.VITE_SUPABASE_URL = info.url;
  process.env.VITE_SUPABASE_ANON_KEY = info.anonKey;
  const vite = await createServer({ root: ROOT, logLevel: 'error', server: { port, strictPort: true }, envFile: false,
    define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(info.url), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(info.anonKey) } });
  await vite.listen();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  const base = `http://localhost:${port}/`;
  const errors = [];
  async function open(opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
    await page.goto(base);
    return page;
  }
  async function signIn(page, name, password = 'TestPass123') {
    await page.goto(base + '#/sign-in');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForSelector('.menu__nav');
  }
  const shot = (page, name) => { fs.mkdirSync(path.join(ROOT, 'tests/shots'), { recursive: true }); return page.screenshot({ path: path.join(ROOT, 'tests/shots', name + '.png') }); };
  const stop = async () => { await browser.close(); await vite.close(); backend.server.close(); };
  return { base, open, signIn, shot, stop, errors, backend, browser };
}
