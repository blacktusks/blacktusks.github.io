import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// The stronghold image is 2400x1800; the campfire sits here in it.
const IMG_W = 2400, IMG_H = 1800, FIRE_X = 0.5038, FIRE_Y = 0.5594;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface Fit { scale: number; left: number; top: number; fx: number; fy: number; portrait: boolean }

/** Cover-fit the background and slide it so the campfire lands where the layout wants it. */
function fit(w: number, h: number): Fit {
  const portrait = h > w * 1.05;
  const scale = Math.max(w / IMG_W, h / IMG_H) * (portrait ? 1.0 : 1.04);
  const iw = IMG_W * scale, ih = IMG_H * scale;
  const wantX = portrait ? 0.3 : 0.56, wantY = portrait ? 0.6 : 0.6;
  const left = Math.min(0, Math.max(w - iw, wantX * w - FIRE_X * iw));
  const top = Math.min(0, Math.max(h - ih, wantY * h - FIRE_Y * ih));
  return { scale, left, top, fx: left + FIRE_X * iw, fy: top + FIRE_Y * ih, portrait };
}

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; seed: number; kind: 0 | 1 | 2 }

function sprite(stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return c;
}

// The flame itself is drawn by a small shader: rising noise eats at a teardrop
// shape, so it licks and tears the way fire does instead of looking like a
// glowing blob. Sizes are in picture pixels (the orc beside the fire is about
// 55 tall), so the fire keeps its proportion on any screen.
const FLAME_W = 150, FLAME_H = 156;
const FLAME_VERT = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FLAME_FRAG = `precision mediump float;
uniform float t, flick; varying vec2 v;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  float x = (v.x - 0.5) * 2.0, y = v.y;                       // x: -1..1, y: 0 at the logs, 1 at the top
  float billow = fbm(vec2(x * 1.7, y * 2.2 - t * 1.5));       // slow, large
  float lick = fbm(vec2(x * 3.9 + 4.0, y * 4.4 - t * 3.0));   // fast, fine
  float lean = (billow - 0.5) * 0.85 * y + sin(t * 0.8) * 0.06 * y;
  float reach = 0.66 + 0.22 * flick;                          // how high this moment's flame gets
  float width = 0.74 * pow(max(0.0, 1.0 - y / reach), 0.8) * (0.86 + 0.28 * billow);
  float body = 1.0 - abs(x + lean) / max(width, 0.0001);
  float f = body + (lick - 0.5) * (0.7 + 1.3 * y) - y * 0.18;
  f *= smoothstep(0.0, 0.07, y);                              // sits on the logs, no hard bottom edge
  float a = smoothstep(0.08, 0.5, f);
  vec3 col = mix(vec3(0.62, 0.09, 0.02), vec3(0.98, 0.42, 0.07), smoothstep(0.1, 0.45, f));
  col = mix(col, vec3(1.0, 0.78, 0.34), smoothstep(0.42, 0.78, f));
  col = mix(col, vec3(1.0, 0.95, 0.8), smoothstep(0.8, 1.15, f) * (1.0 - y));
  gl_FragColor = vec4(col * a, a);
}`;

/**
 * The fire on the log pile: the shader flame, plus sparks, thin smoke and the
 * glow in the logs on a plain canvas. \`light\` is a separate element that warms
 * the ground with an overlay blend, which tints what is already there instead
 * of laying orange fog over it.
 */
function useFire(canvasRef: React.RefObject<HTMLCanvasElement>, flameRef: React.RefObject<HTMLCanvasElement>, lightRef: React.RefObject<HTMLDivElement>, f: Fit) {
  const fitRef = useRef(f); fitRef.current = f;
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const still = reducedMotion();
    const hot = sprite([[0, 'rgba(255,238,196,0.9)'], [0.35, 'rgba(255,196,110,0.55)'], [1, 'rgba(255,150,60,0)']]);
    const mid = sprite([[0, 'rgba(255,170,74,0.8)'], [0.45, 'rgba(236,112,40,0.4)'], [1, 'rgba(200,70,20,0)']]);
    const bed = sprite([[0, 'rgba(255,170,80,0.9)'], [0.4, 'rgba(236,96,36,0.5)'], [1, 'rgba(150,40,10,0)']]);
    const ember = sprite([[0, 'rgba(255,214,150,1)'], [0.5, 'rgba(255,130,50,0.6)'], [1, 'rgba(255,80,10,0)']]);
    const smoke = sprite([[0, 'rgba(120,108,106,0.5)'], [0.6, 'rgba(96,86,84,0.2)'], [1, 'rgba(80,70,68,0)']]);
    const parts: Spark[] = [];
    let raf = 0, last = performance.now(), flick = 0.9, target = 0.9, sinceFlick = 0, owedSmoke = 0, owedSpark = 0;

    // the shader flame; if WebGL is missing the plain-canvas fallback below stands in
    const fc = flameRef.current;
    const gl = fc?.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false }) ?? null;
    let uT: WebGLUniformLocation | null = null, uFlick: WebGLUniformLocation | null = null, flameOk = false;
    if (gl) {
      const shader = (type: number, src: string) => { const sh = gl.createShader(type)!; gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, FLAME_VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FLAME_FRAG)); gl.linkProgram(prog);
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        uT = gl.getUniformLocation(prog, 't'); uFlick = gl.getUniformLocation(prog, 'flick'); flameOk = true;
      }
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); window.addEventListener('resize', resize);
    const rnd = Math.random;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const { fx, fy, scale: px } = fitRef.current;       // px: one picture pixel on screen
      const t = now / 1000;
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      // an uneven flicker, shared by the flame and the light it throws
      sinceFlick += dt; if (sinceFlick > 0.07 + rnd() * 0.1) { sinceFlick = 0; target = 0.7 + rnd() * 0.3; }
      flick += (target - flick) * Math.min(1, dt * 9);
      if (lightRef.current) lightRef.current.style.opacity = String(still ? 0.8 : 0.52 + flick * 0.42);
      const breeze = 0.5 + 0.5 * Math.sin(t * 0.43) * Math.sin(t * 0.17 + 1.3);

      if (flameOk && gl && fc) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(2, Math.round(fc.clientWidth * dpr)), h = Math.max(2, Math.round(fc.clientHeight * dpr));
        if (fc.width !== w || fc.height !== h) { fc.width = w; fc.height = h; gl.viewport(0, 0, w, h); }
        gl.uniform1f(uT, still ? 3.0 : t); gl.uniform1f(uFlick, still ? 0.85 : flick);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      if (!still) {
        owedSmoke += dt * 3;
        while (owedSmoke >= 1) {
          owedSmoke -= 1;
          parts.push({ x: fx + (rnd() - 0.5) * 18 * px, y: fy - 78 * px, vx: (5 + rnd() * 7) * px, vy: -(24 + rnd() * 12) * px,
            life: 0, max: 5.5 + rnd() * 3, size: (16 + rnd() * 9) * px, seed: rnd() * 6.283, kind: 2 });
        }
        owedSpark += dt * 2.4;
        while (owedSpark >= 1) {
          owedSpark -= 1;
          parts.push({ x: fx + (rnd() - 0.5) * 22 * px, y: fy - (22 + rnd() * 40) * px, vx: (rnd() - 0.4) * 22 * px, vy: -(60 + rnd() * 70) * px,
            life: 0, max: 1.1 + rnd() * 1.7, size: (0.9 + rnd() * 0.7) * px, seed: rnd() * 6.283, kind: 1 });
        }
      }

      // smoke first, drawn plainly so it greys what is behind it a little
      ctx.globalCompositeOperation = 'source-over';
      for (const s of parts) {
        if (s.kind !== 2) continue;
        const a = s.life / s.max;
        const size = s.size * (1 + a * 3.2);
        ctx.globalAlpha = Math.min(1, a / 0.15) * (1 - a) * 0.12;
        ctx.drawImage(smoke, s.x - size, s.y - size, size * 2, size * 2);
      }

      // the glowing bed in the logs, added light on light
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 + flick * 0.3;
      ctx.drawImage(bed, fx - 34 * px, fy - 9 * px, 68 * px, 22 * px);
      if (!flameOk) {         // no WebGL: a soft steady flame instead of none
        ctx.globalAlpha = 0.55; ctx.drawImage(mid, fx - 24 * px, fy - 84 * px, 48 * px, 96 * px);
        ctx.globalAlpha = 0.6; ctx.drawImage(hot, fx - 13 * px, fy - 50 * px, 26 * px, 58 * px);
      }

      for (let i = parts.length - 1; i >= 0; i--) {
        const s = parts[i]; s.life += dt;
        if (s.life >= s.max) { parts.splice(i, 1); continue; }
        const a = s.life / s.max;
        if (s.kind === 1) {
          s.vx += (Math.sin(t * 2.3 + s.seed) * 30 + breeze * 18) * px * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy *= 0.985;
          ctx.globalAlpha = (1 - a) * (0.55 + 0.45 * Math.sin(t * 23 + s.seed));
          ctx.drawImage(ember, s.x - s.size * 2, s.y - s.size * 2, s.size * 4, s.size * 4);
        } else {
          s.vx += (breeze * 9 - 1) * px * dt; s.x += s.vx * dt + Math.sin(t * 0.9 + s.seed) * 2 * px * dt; s.y += s.vy * dt;
        }
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [canvasRef, flameRef, lightRef]);
}

const VERT = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision mediump float;
uniform sampler2D tex, mask; uniform float t; varying vec2 v;
void main(){
  float w = texture2D(mask, v).r;
  float gust = 0.62 + 0.38 * sin(t * 0.31) * sin(t * 0.13 + 1.7);
  float ph = v.y * 8.5 - t * 1.55 + v.x * 3.2;
  float a = sin(ph) * 0.62 + sin(ph * 1.9 + 1.3 + t * 0.55) * 0.28 + sin(v.x * 13.0 + t * 2.1) * 0.10;
  vec2 off = vec2(a * 0.0125, cos(ph * 0.8) * 0.0045) * w * gust;
  vec4 c = texture2D(tex, v + off);
  float slope = cos(ph) * 0.62 + cos(ph * 1.9 + 1.3 + t * 0.55) * 0.53;
  c.rgb *= 1.0 + slope * 0.17 * w * gust;
  float fire = 0.94 + 0.06 * sin(t * 7.3) * sin(t * 3.1 + v.y * 4.0);
  c.rgb *= mix(vec3(1.0), vec3(1.07, 0.97, 0.9) * fire, smoothstep(0.2, 1.0, v.x));
  gl_FragColor = c;
}`;

/** The clan banner. The cloth is moved by a small shader; the frame holds still. */
export function Banner({ className = '', onReady }: { className?: string; onReady?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const told = useRef(onReady); told.current = onReady;
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) { setFailed(true); return; }
    const shader = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setFailed(true); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);

    let ready = 0, raf = 0, dead = false;
    const load = (src: string, unit: number, name: string) => {
      const img = new Image();
      img.onload = () => {
        if (dead) return;
        const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(prog, name), unit);
        if (++ready === 2) { canvas.classList.add('is-ready'); raf = requestAnimationFrame(draw); told.current?.(); }
      };
      img.onerror = () => setFailed(true);
      img.src = src;
    };
    const uT = gl.getUniformLocation(prog, 't');
    const still = reducedMotion();
    const draw = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = Math.min(1100, Math.round(canvas.clientWidth * dpr));
      if (size && canvas.width !== size) { canvas.width = canvas.height = size; gl.viewport(0, 0, size, size); }
      gl.uniform1f(uT, still ? 2.0 : now / 1000);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!still) raf = requestAnimationFrame(draw);
    };
    load('./img/banner.webp', 0, 'tex'); load('./img/banner_weight.png', 1, 'mask');
    return () => { dead = true; cancelAnimationFrame(raf); };
  }, []);
  if (failed) return <img className={`banner ${className}`} src="./img/banner.webp" alt="The Black Tusk banner" onLoad={() => onReady?.()} onError={() => onReady?.()} />;
  return <canvas ref={ref} className={`banner ${className}`} role="img" aria-label="The Black Tusk banner" />;
}

/**
 * Largashbur with the fire burning. `quiet` drops the fire and dims it for inner screens.
 *
 * First load: a tiny blurred copy of the picture shows at once, in exactly the
 * place the full picture will take. The full picture, the fire and its light
 * are held back until the picture has finished arriving, then fade in together,
 * so a slow connection never shows half a picture or a fire burning on black.
 * The size comes from the scene's own box, which is right on phones even while
 * the browser's bars are sliding in and out.
 */
export function Scene({ quiet = false, onReady }: { quiet?: boolean; onReady?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({ w: window.innerWidth || document.documentElement.clientWidth, h: window.innerHeight || document.documentElement.clientHeight }));
  const [sharp, setSharp] = useState(false);
  const fire = useRef<HTMLCanvasElement>(null);
  const light = useRef<HTMLDivElement>(null);
  const flame = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null; ro?.observe(el);
    const events = ['resize', 'orientationchange', 'pageshow'] as const;
    events.forEach((e) => window.addEventListener(e, measure));
    window.visualViewport?.addEventListener('resize', measure);
    return () => { ro?.disconnect(); events.forEach((e) => window.removeEventListener(e, measure)); window.visualViewport?.removeEventListener('resize', measure); };
  }, []);
  const told = useRef(onReady); told.current = onReady;
  useEffect(() => { if (sharp) told.current?.(); }, [sharp]);
  const f = fit(size.w, size.h);
  useFire(fire, flame, light, f);
  const place = { width: IMG_W * f.scale, height: IMG_H * f.scale, transform: `translate3d(${f.left}px, ${f.top}px, 0)` };
  return (
    <div ref={box} className={`scene ${quiet ? 'scene--quiet' : ''} ${sharp ? 'is-sharp' : ''}`} aria-hidden="true">
      <img className="scene__bg" src="./img/largashbur-dim.webp" alt="" draggable={false} style={place} />
      {!quiet && <img className="scene__bg scene__bg--sharp" src="./img/largashbur.webp" alt="" draggable={false} style={place}
        onLoad={() => setSharp(true)} onError={() => told.current?.()} ref={(img) => { if (img?.complete && img.naturalWidth > 0) setSharp(true); }} />}
      {!quiet && (
        <div className="scene__fireset">
          <div ref={light} className="scene__firelight" style={{ left: f.fx, top: f.fy, width: 760 * f.scale, height: 430 * f.scale }} />
          <canvas ref={fire} className="scene__fire" />
          <canvas ref={flame} className="scene__flame" style={{ left: f.fx, top: f.fy + 7 * f.scale, width: FLAME_W * f.scale, height: FLAME_H * f.scale }} />
        </div>
      )}
      <div className="scene__smoke scene__smoke--a"><i /></div>{!quiet && <div className="scene__smoke scene__smoke--b"><i /></div>}
      <div className="scene__shade" />
    </div>
  );
}
