import { useEffect, useRef, useState } from 'react';

// The stronghold image is 2400x1800; the campfire sits here in it.
const IMG_W = 2400, IMG_H = 1800, FIRE_X = 0.5025, FIRE_Y = 0.5585;
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

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; kind: 0 | 1 }

function sprite(stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return c;
}

/** Fire, embers and the light they throw, drawn over the background image. */
function useFire(canvasRef: React.RefObject<HTMLCanvasElement>, f: Fit) {
  const fitRef = useRef(f); fitRef.current = f;
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const still = reducedMotion();
    const flame = sprite([[0, 'rgba(255,236,170,0.95)'], [0.25, 'rgba(255,170,60,0.75)'], [0.6, 'rgba(220,70,20,0.28)'], [1, 'rgba(120,20,0,0)']]);
    const ember = sprite([[0, 'rgba(255,220,150,1)'], [0.4, 'rgba(255,120,40,0.7)'], [1, 'rgba(255,60,0,0)']]);
    const glow = sprite([[0, 'rgba(255,150,60,0.55)'], [0.35, 'rgba(255,110,40,0.22)'], [1, 'rgba(255,80,20,0)']]);
    const sparks: Spark[] = [];
    let raf = 0, last = performance.now(), flick = 1, target = 1, acc = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); window.addEventListener('resize', resize);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const { fx, fy, scale } = fitRef.current;
      const u = 1800 * scale / 100;                 // 1% of the image height, in screen px
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.globalCompositeOperation = 'lighter';

      acc += dt; if (acc > 0.09) { acc = 0; target = 0.78 + Math.random() * 0.34; }
      flick += (target - flick) * Math.min(1, dt * 9);

      // light on the ground and the longhouse wall
      const gr = u * 22 * (0.94 + flick * 0.08);
      ctx.globalAlpha = 0.62 * flick; ctx.drawImage(glow, fx - gr, fy - gr * 0.6, gr * 2, gr * 1.2);
      ctx.globalAlpha = 0.5 * flick; ctx.drawImage(glow, fx - gr * 0.28, fy - gr * 0.2, gr * 0.56, gr * 0.36);

      if (!still) {
        for (let i = 0; i < 4; i++) {
          const off = (Math.random() - 0.5);
          sparks.push({ x: fx + off * u * 1.5, y: fy + Math.random() * u * 0.35,
            vx: -off * u * 1.1 + (Math.random() - 0.5) * u * 0.5, vy: -u * (3.4 + Math.random() * 3.6) * (1 - Math.abs(off) * 0.9),
            life: 0, max: 0.38 + Math.random() * 0.42, size: u * (0.62 + Math.random() * 0.6), kind: 0 });
        }
        if (Math.random() < dt * 8) {
          sparks.push({ x: fx + (Math.random() - 0.5) * u * 1.2, y: fy - u * 1.5, vx: (Math.random() - 0.5) * u * 3,
            vy: -u * (5 + Math.random() * 6), life: 0, max: 1.6 + Math.random() * 2.4, size: u * (0.12 + Math.random() * 0.14), kind: 1 });
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]; s.life += dt;
        if (s.life >= s.max) { sparks.splice(i, 1); continue; }
        const t = s.life / s.max;
        if (s.kind === 0) {
          s.x += s.vx * dt + Math.sin(now / 130 + i) * u * 0.02; s.y += s.vy * dt; s.vx *= 0.96;
          const size = s.size * (1 - t * 0.8);
          ctx.globalAlpha = (t < 0.12 ? t / 0.12 : 1 - t) * 0.5;
          ctx.drawImage(flame, s.x - size, s.y - size * 1.5, size * 2, size * 3);
        } else {
          s.vx += Math.sin(now / 400 + i * 1.7) * u * 0.25 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy *= 0.992;
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.drawImage(ember, s.x - s.size * 2, s.y - s.size * 2, s.size * 4, s.size * 4);
        }
      }
      if (still) {            // a steady flame when motion is turned down
        ctx.globalAlpha = 0.8; ctx.drawImage(flame, fx - u * 2, fy - u * 4, u * 4, u * 5);
      } else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [canvasRef]);
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
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on); window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  const f = fit(size.w, size.h);
  useFire(fire, f);
  return (
    <div className={`scene ${quiet ? 'scene--quiet' : ''}`} aria-hidden="true">
      <img className="scene__bg" src={quiet ? './img/largashbur-dim.webp' : './img/largashbur.webp'} alt="" draggable={false}
        style={{ width: IMG_W * f.scale, height: IMG_H * f.scale, transform: `translate3d(${f.left}px, ${f.top}px, 0)` }} />
      {!quiet && <canvas ref={fire} className="scene__fire" />}
      <div className="scene__smoke scene__smoke--a"><i /></div>{!quiet && <div className="scene__smoke scene__smoke--b"><i /></div>}
      <div className="scene__shade" />
    </div>
  );
}
