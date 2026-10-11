// Contact sheet of the mastery icons: node tests/look_icons.mjs
import fs from 'node:fs';
import { chromium } from 'playwright';
const src = fs.readFileSync('src/lib/masteries.ts', 'utf8');
const js = src.replace(/export interface[^\n]*\n/g, '').replace(/export const SKILLS: Skill\[\] =/, 'const SKILLS =').split('export const SKILL:')[0];
const SKILLS = new Function(js + '; return SKILLS;')();
const svg = (s, size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${s.lines.map((d) => `<path d="${d}"/>`).join('')}${(s.dots ?? []).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</svg>`;
const html = `<body style="margin:0;background:#14100e;color:#ece3cf;font:14px sans-serif;display:grid;grid-template-columns:repeat(6,1fr);gap:14px;padding:18px;width:1100px">${SKILLS.map((s) => `<div style="text-align:center">${svg(s, 120)}<div>${svg(s, 22)} ${s.label}</div></div>`).join('')}</body>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1140, height: 620 } });
await p.setContent(html); fs.mkdirSync('tests/shots', { recursive: true }); await p.screenshot({ path: 'tests/shots/icons.png' }); await b.close();
