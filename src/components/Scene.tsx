import { useEffect, useRef, useState } from 'react';

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

/**
 * A small campfire on the log pile in the picture. Everything is sized in
 * picture pixels (the pile is about 100 wide, the orc beside it about 55 tall)
 * so the flame stays in proportion on any screen: roughly knee to chest high.
 * `light` is a separate element that warms the ground with an overlay blend,
 * which tints what is already there instead of laying orange fog over it.
 */
function useFire(canvasRef: React.RefObject<HTMLCanvasElement>, lightRef: React.RefObject<HTMLDivElement>, f: Fit) {
  const fitRef = useRef(f); fitRef.current = f;
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const still = reducedMotion();
    const hot = sprite([[0, 'rgba(255,238,196,0.9)'], [0.35, 'rgba(255,196,110,0.55)'], [1, 'rgba(255,150,60,0)']]);
    const mid = sprite([[0, 'rgba(255,170,74,0.8)'], [0.45, 'rgba(236,112,40,0.4)'], [1, 'rgba(200,70,20,0)']]);
    const low = sprite([[0, 'rgba(190,72,30,0.6)'], [0.5, 'rgba(130,38,16,0.25)'], [1, 'rgba(90,20,8,0)']]);
    const bed = sprite([[0, 'rgba(255,150,70,0.85)'], [0.4, 'rgba(230,90,36,0.45)'], [1, 'rgba(150,40,10,0)']]);
    const ember = sprite([[0, 'rgba(255,214,150,1)'], [0.5, 'rgba(255,130,50,0.6)'], [1, 'rgba(255,80,10,0)']]);
    const smoke = sprite([[0, 'rgba(150,152,160,0.5)'], [0.6, 'rgba(120,122,130,0.2)'], [1, 'rgba(100,102,110,0)']]);
    const parts: Spark[] = [];
    let raf = 0, last = performance.now(), flick = 0.9, target = 0.9, sinceFlick = 0, owedFlame = 0, owedSmoke = 0, owedSpark = 0;

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
      sinceFlick += dt; if (sinceFlick > 0.07 + rnd() * 0.09) { sinceFlick = 0; target = 0.72 + rnd() * 0.28; }
      flick += (target - flick) * Math.min(1, dt * 10);
      if (lightRef.current) lightRef.current.style.opacity = String(still ? 0.75 : 0.5 + flick * 0.42);
      // the breeze leans the flame and carries the smoke to the right
      const breeze = 0.5 + 0.5 * Math.sin(t * 0.43) * Math.sin(t * 0.17 + 1.3);

      if (!still) {
        owedFlame += dt * 70;
        while (owedFlame >= 1) {
          owedFlame -= 1;
          const off = (rnd() + rnd() + rnd() - 1.5) / 1.5;               // bunched toward the middle
          const tall = 1 - Math.abs(off) * 0.6;
          parts.push({ x: fx + off * 11 * px, y: fy + (rnd() - 0.3) * 4 * px, vx: -off * 9 * px,
            vy: -(58 + rnd() * 52) * tall * px * (0.8 + flick * 0.25), life: 0, max: (0.36 + rnd() * 0.32) * (0.7 + tall * 0.4),
            size: (5.5 + rnd() * 4) * px, seed: rnd() * 6.283, kind: 0 });
        }
        owedSmoke += dt * 2.6;
        while (owedSmoke >= 1) {
          owedSmoke -= 1;
          parts.push({ x: fx + (rnd() - 0.5) * 8 * px, y: fy - 30 * px, vx: (4 + rnd() * 5) * px, vy: -(17 + rnd() * 9) * px,
            life: 0, max: 5 + rnd() * 3, size: (9 + rnd() * 5) * px, seed: rnd() * 6.283, kind: 2 });
        }
        owedSpark += dt * 1.3;
        while (owedSpark >= 1) {
          owedSpark -= 1;
          parts.push({ x: fx + (rnd() - 0.5) * 10 * px, y: fy - (8 + rnd() * 14) * px, vx: (rnd() - 0.4) * 16 * px, vy: -(40 + rnd() * 50) * px,
            life: 0, max: 1 + rnd() * 1.5, size: (0.7 + rnd() * 0.5) * px, seed: rnd() * 6.283, kind: 1 });
        }
      }

      // smoke first, drawn plainly so it greys what is behind it a little
      ctx.globalCompositeOperation = 'source-over';
      for (const s of parts) {
        if (s.kind !== 2) continue;
        const a = s.life / s.max;
        const size = s.size * (1 + a * 3.2);
        ctx.globalAlpha = Math.min(1, a / 0.15) * (1 - a) * 0.11;
        ctx.drawImage(smoke, s.x - size, s.y - size, size * 2, size * 2);
      }

      // the glowing bed in the logs, then the flame, added light on light
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + flick * 0.3;
      ctx.drawImage(bed, fx - 17 * px, fy - 5 * px, 34 * px, 12 * px);

      for (let i = parts.length - 1; i >= 0; i--) {
        const s = parts[i]; s.life += dt;
        if (s.life >= s.max) { parts.splice(i, 1); continue; }
        const a = s.life / s.max;
        if (s.kind === 0) {
          s.vx += (breeze * 10 - 2) * px * dt;
          s.x += s.vx * dt + Math.sin(t * 9 + s.seed) * 5 * px * a * dt * 6; s.y += s.vy * dt;
          const size = s.size * (1 - a * 0.72);
          const fade = Math.min(1, a / 0.08) * Math.pow(1 - a, 1.15);
          const img = a < 0.3 ? hot : a < 0.68 ? mid : low;
          ctx.globalAlpha = fade * (a < 0.3 ? 0.42 : 0.5);
          ctx.drawImage(img, s.x - size * 0.82, s.y - size * 1.5, size * 1.64, size * 3);
        } else if (s.kind === 1) {
          s.vx += (Math.sin(t * 2.3 + s.seed) * 26 + breeze * 14) * px * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy *= 0.985;
          ctx.globalAlpha = (1 - a) * (0.55 + 0.45 * Math.sin(t * 23 + s.seed));
          ctx.drawImage(ember, s.x - s.size * 2, s.y - s.size * 2, s.size * 4, s.size * 4);
        } else {
          s.vx += (breeze * 7 - 1) * px * dt; s.x += s.vx * dt + Math.sin(t * 0.9 + s.seed) * 2 * px * dt; s.y += s.vy * dt;
        }
      }

      if (still) {            // a steady flame when motion is turned down
        ctx.globalAlpha = 0.5; ctx.drawImage(mid, fx - 10 * px, fy - 34 * px, 20 * px, 40 * px);
        ctx.globalAlpha = 0.5; ctx.drawImage(hot, fx - 6 * px, fy - 22 * px, 12 * px, 26 * px);
      } else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [canvasRef, lightRef]);
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
export function Banner({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
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
        if (++ready === 2) { canvas.classList.add('is-ready'); raf = requestAnimationFrame(draw); }
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
  if (failed) return <img className={`banner ${className}`} src="./img/banner.webp" alt="The Black Tusk banner" />;
  return <canvas ref={ref} className={`banner ${className}`} role="img" aria-label="The Black Tusk banner" />;
}

/** Largashbur at dusk with the campfire burning. `quiet` drops the fire and dims it for inner screens. */
export function Scene({ quiet = false }: { quiet?: boolean }) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const fire = useRef<HTMLCanvasElement>(null);
  const light = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on); window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  const f = fit(size.w, size.h);
  useFire(fire, light, f);
  return (
    <div className={`scene ${quiet ? 'scene--quiet' : ''}`} aria-hidden="true">
      <img className="scene__bg" src={quiet ? './img/largashbur-dim.webp' : './img/largashbur.webp'} alt="" draggable={false}
        style={{ width: IMG_W * f.scale, height: IMG_H * f.scale, transform: `translate3d(${f.left}px, ${f.top}px, 0)` }} />
      {!quiet && <div ref={light} className="scene__firelight"
        style={{ left: f.fx, top: f.fy, width: 430 * f.scale, height: 240 * f.scale }} />}
      {!quiet && <canvas ref={fire} className="scene__fire" />}
      <div className="scene__smoke scene__smoke--a"><i /></div>{!quiet && <div className="scene__smoke scene__smoke--b"><i /></div>}
      <div className="scene__shade" />
    </div>
  );
}
