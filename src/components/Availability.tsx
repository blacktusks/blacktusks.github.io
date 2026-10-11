import { useMemo, useRef } from 'react';
import { DAYS, PRESETS, allZones, deviceZone, emptyWeek, hourLabel, hoursFree, isFree, mergeWeek, setFree, shiftWeek, zoneName, type Week } from '../lib/availability';

/** A member's week as others see it: one thin row per day, converted to the viewer's own clock. */
export function AvailabilityStrip({ week, zone, own }: { week: Week; zone: string | null; own?: boolean }) {
  const mine = deviceZone();
  const shown = useMemo(() => (zone ? shiftWeek(week, zone, mine) : week), [week, zone, mine]);
  if (!hoursFree(week)) return null;
  const whose = own ? 'Your card says' : 'Their time zone is';
  return (
    <div className="avail">
      <div className="avail__grid" role="img" aria-label={`Usually free ${hoursFree(week)} hours a week`}>
        <span />{[0, 6, 12, 18].map((h) => <span key={h} className="avail__hour" style={{ gridColumn: `${h + 2} / span 6` }}>{hourLabel(h)}</span>)}
        {DAYS.map((day, d) => (
          <div className="avail__row" key={day}>
            <span className="avail__day">{day}</span>
            {Array.from({ length: 24 }, (_, h) => <i key={h} className={isFree(shown, d, h) ? 'is-on' : ''} />)}
          </div>
        ))}
      </div>
      {zone ? (
        <p className="avail__zone">
          <strong>These hours are shown in your time.</strong> They are converted automatically to the clock on this device, {zoneName(mine)}.
          {' '}{zone === mine ? `${whose} the same zone.` : `${whose} ${zoneName(zone)}.`}
        </p>
      ) : (
        <p className="avail__zone"><strong>These hours are not converted.</strong> No time zone is set on this card, so they are shown as written.</p>
      )}
    </div>
  );
}

/** Paint the hours you are usually free: tap a square, or drag across several. */
export function AvailabilityEditor({ week, zone, onWeek, onZone }: { week: Week; zone: string; onWeek: (w: Week) => void; onZone: (z: string) => void }) {
  const paint = useRef<boolean | null>(null);
  const latest = useRef(week); latest.current = week;
  const zones = useMemo(() => { const z = allZones(); return z.includes(zone) || !zone ? z : [zone, ...z]; }, [zone]);
  const device = deviceZone();
  const cellAt = (e: React.PointerEvent): [number, number] | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const d = el?.dataset.d, h = el?.dataset.h;
    return d !== undefined && h !== undefined ? [Number(d), Number(h)] : null;
  };
  const down = (e: React.PointerEvent) => {
    const c = cellAt(e); if (!c) return;
    paint.current = !isFree(latest.current, c[0], c[1]);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    onWeek(setFree(latest.current, c[0], c[1], paint.current));
  };
  const move = (e: React.PointerEvent) => {
    if (paint.current === null) return;
    const c = cellAt(e); if (!c || isFree(latest.current, c[0], c[1]) === paint.current) return;
    onWeek(setFree(latest.current, c[0], c[1], paint.current));
  };
  const up = () => { paint.current = null; };
  const key = (e: React.KeyboardEvent, d: number, h: number) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onWeek(setFree(week, d, h, !isFree(week, d, h))); }
  };
  return (
    <div className="availedit">
      <label className="field"><span>Your time zone</span>
        <select value={zone} onChange={(e) => onZone(e.target.value)}>
          <option value="">Not set</option>
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
        {zone !== device && <small>This device is on {zoneName(device)}. <button type="button" className="linkbtn" onClick={() => onZone(device)}>Use it</button></small>}
      </label>
      <span className="label">Hours you are usually free to play</span>
      <div className="row availedit__quick">
        {PRESETS.map(([name, w]) => <button type="button" key={name} className="btn btn--small" onClick={() => onWeek(mergeWeek(week, w))}>+ {name}</button>)}
        <button type="button" className="btn btn--small btn--ghost" onClick={() => onWeek(emptyWeek())}>Clear</button>
      </div>
      <div className="availedit__grid" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="group" aria-label="Hours free, by day">
        <span />{DAYS.map((day) => <span key={day} className="availedit__day">{day}</span>)}
        {Array.from({ length: 24 }, (_, h) => (
          <div className="availedit__row" key={h}>
            <span className="availedit__hour">{h % 3 === 0 ? hourLabel(h) : ''}</span>
            {DAYS.map((day, d) => (
              <button type="button" key={day} data-d={d} data-h={h} className={isFree(week, d, h) ? 'is-on' : ''} aria-pressed={isFree(week, d, h)}
                aria-label={`${day} ${hourLabel(h)} to ${hourLabel((h + 1) % 24)}`} onKeyDown={(e) => key(e, d, h)} />
            ))}
          </div>
        ))}
      </div>
      <p className="hint">Tap a square to switch an hour on or off, or drag down a column to fill it. {hoursFree(week)} hours marked. Others see this in their own time.</p>
    </div>
  );
}
