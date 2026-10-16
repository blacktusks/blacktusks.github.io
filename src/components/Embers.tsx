// The slow embers that drift over the home screen, on a screen of their own choosing. Same sprite,
// same rate (three or four a second), same seven to thirteen seconds aloft, the same wander and
// pulse; half rise from the ground anywhere, half from the foot of whatever `from` points at.
import { useEffect, useRef } from 'react';

interface Ember { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; seed: number }

function sprite(stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return c;
}

export function Embers({ from, className = '' }: { from?: React.RefObject<HTMLElement>; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const ember = sprite([[0, 'rgba(255,214,150,1)'], [0.5, 'rgba(255,130,50,0.6)'], [1, 'rgba(255,80,10,0)']]);
    const parts: Ember[] = []; const rnd = Math.random;
    let raf = 0, last = performance.now(), owed = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); window.addEventListener('resize', resize);
    const spawn = (age = 0) => {
      const W = canvas.clientWidth, H = canvas.clientHeight, u = Math.max(1, Math.min(W, H) / 430);
      const box = from?.current?.getBoundingClientRect(); const top = canvas.getBoundingClientRect();
      const fromSource = !!box && rnd() < 0.5;
      const x = fromSource ? box!.left - top.left + box!.width * (0.5 + (rnd() - 0.5) * 0.6) : rnd() * W;
      const y = fromSource ? box!.bottom - top.top - box!.height * (0.05 + rnd() * 0.2) : H * (0.5 + rnd() * 0.55);
      const e: Ember = { x, y, vx: (rnd() - 0.35) * 10 * u, vy: -(fromSource ? 20 + rnd() * 22 : 9 + rnd() * 16) * u,
        life: 0, max: 7 + rnd() * 6, size: (0.75 + rnd() * 0.85) * u, seed: rnd() * 6.283 };
      // the first ones are started part way through their flight, so the screen does not open empty
      if (age) { const t = Math.min(age, e.max * 0.9); e.life = t; e.x += e.vx * t; e.y += e.vy * t; }
      parts.push(e);
    };
    for (let i = 0; i < 30; i++) spawn(rnd() * 9);
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
      const breeze = 0.5 + 0.5 * Math.sin(t * 0.43) * Math.sin(t * 0.17 + 1.3);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.globalCompositeOperation = 'lighter';
      owed += dt * 3.5;
      while (owed >= 1) { owed -= 1; spawn(); }
      for (let i = parts.length - 1; i >= 0; i--) {
        const s = parts[i]; s.life += dt;
        if (s.life >= s.max) { parts.splice(i, 1); continue; }
        const a = s.life / s.max;
        s.vx += (Math.sin(t * 0.8 + s.seed) * 7 + (breeze - 0.3) * 9) * dt; s.vx *= 0.995; s.vy *= 0.999;
        s.x += s.vx * dt; s.y += s.vy * dt;
        const glow = Math.min(1, a / 0.14) * Math.min(1, (1 - a) / 0.4);
        ctx.globalAlpha = glow * (0.66 + 0.24 * Math.sin(t * 5.3 + s.seed) * Math.sin(t * 1.7 + s.seed * 2.1));
        ctx.drawImage(ember, s.x - s.size * 2.6, s.y - s.size * 2.6, s.size * 5.2, s.size * 5.2);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [from]);
  return <canvas ref={ref} className={`embers ${className}`} aria-hidden="true" />;
}
