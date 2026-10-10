// Background removal for item pictures, done in the browser before upload.
// Works outward from the picture's edges, so it suits items shown on a plain
// or softly graded backdrop (wiki renders, inventory screenshots).

function load(file: Blob): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('That file is not a picture this browser can read.')); };
    img.src = url;
  });
}

export interface Cutout { blob: Blob; url: string; removed: boolean }

export async function cutout(file: Blob, opts: { remove: boolean; tolerance: number; size?: number }): Promise<Cutout> {
  const img = await load(file);
  const max = 720; const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, w, h);
  const image = g.getImageData(0, 0, w, h); const px = image.data;

  let seeThrough = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) seeThrough++;
  const alreadyCut = seeThrough > w * h * 0.02;
  let removed = false;

  if (opts.remove && !alreadyCut) {
    const step = Math.max(4, opts.tolerance * 0.55), drift = Math.max(12, opts.tolerance * 2.6);
    const bg = new Uint8Array(w * h);
    const queue = new Int32Array(w * h); const origin = new Int32Array(w * h);
    let head = 0, tail = 0;
    const seed = (x: number, y: number) => { const p = y * w + x; if (!bg[p]) { bg[p] = 1; origin[p] = p; queue[tail++] = p; } };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    const dist = (a: number, b: number) => {
      const dr = px[a * 4] - px[b * 4], dg = px[a * 4 + 1] - px[b * 4 + 1], db = px[a * 4 + 2] - px[b * 4 + 2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };
    while (head < tail) {
      const p = queue[head++]; const x = p % w, y = (p - x) / w; const o = origin[p];
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || bg[q]) continue;
        if (dist(q, p) <= step && dist(q, o) <= drift) { bg[q] = 1; origin[q] = o; queue[tail++] = q; }
      }
    }
    // only accept the cut if it left something behind
    if (tail > w * h * 0.03 && tail < w * h * 0.985) {
      removed = true;
      for (let p = 0; p < w * h; p++) {
        if (bg[p]) { px[p * 4 + 3] = 0; continue; }
        const x = p % w, y = (p - x) / w; let near = 0;       // soften the edge
        if (x > 0 && bg[p - 1]) near++; if (x < w - 1 && bg[p + 1]) near++; if (y > 0 && bg[p - w]) near++; if (y < h - 1 && bg[p + w]) near++;
        if (near) px[p * 4 + 3] = Math.round(px[p * 4 + 3] * (1 - near * 0.2));
      }
      g.putImageData(image, 0, 0);
    }
  }

  // trim to the item and fit a square-ish canvas
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1; const size = opts.size ?? 512; const k = Math.min(1, size / Math.max(cw, ch));
  const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(cw * k)); out.height = Math.max(1, Math.round(ch * k));
  out.getContext('2d')!.drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
  const blob: Blob = await new Promise((ok, bad) => out.toBlob((b) => (b ? ok(b) : bad(new Error('Could not prepare the picture.'))), 'image/png'));
  return { blob, url: URL.createObjectURL(blob), removed };
}
