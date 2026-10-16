// A button that, each time it is pressed, sends up green praying hands with a fire flaring behind
// them and small flames flying out in every direction, each turning slowly as it goes. Used by
// Pay Respect on a fallen clanmate's card and Praise Malacath at the shrine. Nothing is saved.
import { useEffect, useRef, useState } from 'react';

interface Spark { dx: number; dy: number; r0: number; r1: number; s: number; d: number; delay: number }
interface Burst { id: number; sparks: Spark[] }

const SPARKS = 10, LIFE_MS = 2600;
function sparks(): Spark[] {
  const turn = Math.random() * Math.PI * 2;
  return Array.from({ length: SPARKS }, (_, i) => {
    const angle = turn + (i / SPARKS) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;   // all round, never bunched
    const dist = 64 + Math.random() * 58;
    return {
      dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist * 0.9 - 12,
      r0: (Math.random() - 0.5) * 50,
      r1: (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 150),             // a slow turn, one way or the other
      s: 0.42 + Math.random() * 0.3, d: 1.5 + Math.random() * 0.8, delay: 0.05 + Math.random() * 0.15,
    };
  });
}

export function FireBurstButton({ label, said, onPress, className = 'btn' }: {
  label: string; said: string; onPress?: () => void; className?: string;
}) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const next = useRef(0); const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  const press = () => {
    const id = ++next.current;
    setBursts((b) => [...b.slice(-4), { id, sparks: sparks() }]);
    // gone as soon as it has faded, whether or not the browser was drawing at the time
    timers.current.push(window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), LIFE_MS));
    onPress?.();
  };
  return (
    <span className="burstbtn">
      <button type="button" className={className} onClick={press}>{label}</button>
      {bursts.map((b) => (
        <span key={b.id} className="burst" aria-hidden="true">
          <span className="burst__fire">🔥</span>
          {b.sparks.map((s, i) => (
            <span key={i} className="burst__spark" style={{ ['--dx' as any]: `${s.dx.toFixed(1)}px`, ['--dy' as any]: `${s.dy.toFixed(1)}px`,
              ['--r0' as any]: `${s.r0.toFixed(0)}deg`, ['--r1' as any]: `${s.r1.toFixed(0)}deg`, ['--s' as any]: s.s.toFixed(2),
              animationDuration: `${s.d.toFixed(2)}s`, animationDelay: `${s.delay.toFixed(2)}s` }}>🔥</span>
          ))}
          <span className="burst__hands">🙏</span>
        </span>
      ))}
      <span className="sr" role="status">{bursts.length ? said : ''}</span>
    </span>
  );
}
