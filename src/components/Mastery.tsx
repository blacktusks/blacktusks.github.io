import { MAX_LEVEL, SKILL, type Mastery } from '../lib/masteries';

export function SkillIcon({ skill, size = 18 }: { skill: string; size?: number }) {
  const s = SKILL[skill]; if (!s) return null;
  return (
    <svg className="skillicon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      {s.lines.map((d, i) => <path key={i} d={d} />)}
      {s.dots?.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />)}
    </svg>
  );
}

/**
 * "ICON Lvl 3 Blacksmith". The tag is plain iron at level 0 and gains metal,
 * glow, a moving sheen and finally sparks as the level climbs to 5.
 * `mini` is the icon and number only, for the members list.
 */
export function MasteryTag({ mastery, mini = false }: { mastery: Mastery; mini?: boolean }) {
  const s = SKILL[mastery.skill]; if (!s) return null;
  const level = Math.max(0, Math.min(MAX_LEVEL, Math.round(mastery.level)));
  return (
    <span className={`mastery mastery--l${level} ${mini ? 'mastery--mini' : ''}`} title={`${s.label}, level ${level} of ${MAX_LEVEL}`}>
      <SkillIcon skill={s.id} size={mini ? 15 : 18} />
      {mini ? <b aria-hidden="true">{level}</b> : <><span className="mastery__lvl">Lvl {level}</span><span className="mastery__name">{s.label}</span></>}
      {mini && <span className="sr">{s.label}, level {level}</span>}
      {level >= 4 && <i className="mastery__spark mastery__spark--a" aria-hidden="true" />}
      {level >= 5 && <><i className="mastery__spark mastery__spark--b" aria-hidden="true" /><i className="mastery__spark mastery__spark--c" aria-hidden="true" /></>}
    </span>
  );
}

export function Masteries({ list, mini = false }: { list: Mastery[]; mini?: boolean }) {
  if (!list.length) return null;
  return <span className={`masteries ${mini ? 'masteries--mini' : ''}`}>{list.map((m) => <MasteryTag key={m.skill} mastery={m} mini={mini} />)}</span>;
}
