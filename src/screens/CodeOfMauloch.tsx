import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page, useTitle } from '../components/ui';
import { Embers } from '../components/Embers';
import { FireBurstButton } from '../components/FireBurst';
import { MALACATH_WORDS } from '../lib/malacath';
import { sfx } from '../lib/sound';

/** One of Malacath's sayings: 1.6 s rising out of the fog, 6 s held, 2.4 s sinking back. */
export const IN_MS = 1600, HOLD_MS = 6000, OUT_MS = 2400;
export const WORD_MS = IN_MS + HOLD_MS + OUT_MS;

/** Any saying but the last one. */
export function pickWord(last: number, count: number, rnd = Math.random): number {
  if (count < 2 || last < 0 || last >= count) return Math.floor(rnd() * count);
  const i = Math.floor(rnd() * (count - 1));
  return i >= last ? i + 1 : i;
}

interface Word { id: number; text: string; born: number; leaving: number | null }

/**
 * The Code of Mauloch: the way to the Seven Tenets, and Malacath's shrine. Praise him and green hands
 * rise in fire, and one of his sayings comes up out of the fog behind the statue. Praise him again while
 * he speaks and the saying sinks back early as the next one rises, both at once; a saying that is still
 * rising finishes rising first.
 */
export default function CodeOfMauloch() {
  useTitle('Code of Mauloch');
  const go = useNavigate();
  const stage = useRef<HTMLDivElement>(null);
  const [words, setWords] = useState<Word[]>([]);
  const list = useRef<Word[]>([]);
  const last = useRef(-1); const count = useRef(0); const timers = useRef(new Set<number>()); const queued = useRef(false);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timers.current.delete(t); fn(); }, ms); timers.current.add(t); };
  const commit = (next: Word[]) => { list.current = next; setWords(next); };
  const speak = () => {
    const now = performance.now();
    // whatever he is saying now sinks back early, unless it is already sinking on its own
    const next = list.current.map((w) => (w.leaving === null && now - w.born < IN_MS + HOLD_MS ? { ...w, leaving: now } : w));
    for (const w of next) if (w.leaving === now) later(() => commit(list.current.filter((x) => x.id !== w.id)), OUT_MS);
    const i = pickWord(last.current, MALACATH_WORDS.length); last.current = i;
    const word: Word = { id: ++count.current, text: MALACATH_WORDS[i], born: now, leaving: null };
    later(() => commit(list.current.filter((x) => x.id !== word.id)), WORD_MS);
    commit([...next, word]);
  };
  const praise = () => {
    const now = performance.now();
    const rising = list.current.find((w) => w.leaving === null && now - w.born < IN_MS);
    if (!rising) { speak(); return; }
    // a saying still rising out of the fog finishes rising; the next follows the moment it has
    if (queued.current) return;
    queued.current = true;
    later(() => { queued.current = false; speak(); }, IN_MS - (now - rising.born));
  };
  return (
    <div className="shrine">
      <header className="shrine__head">
        <h1 className="page__title">Code of Mauloch</h1>
        <p className="page__sub">The way of the Orsimer</p>
      </header>
      <nav className="shrine__nav" aria-label="Code of Mauloch">
        <button className="shrine__btn" onClick={() => { sfx('select'); go('/code/tenets'); }}>The Seven Tenets</button>
      </nav>
      <div className="shrine__stage" ref={stage}>
        <div className="shrine__fog shrine__fog--far" aria-hidden="true"><i /></div>
        <div className="shrine__halo" aria-hidden="true" />
        <div className="shrine__fog shrine__fog--mid" aria-hidden="true"><i /></div>
        <div className="shrine__glow" aria-hidden="true" />
        <img className="shrine__statue" src="./img/malacath.webp" alt="The statue of Malacath upon its stone" draggable={false} />
        <div className="shrine__fog shrine__fog--front" aria-hidden="true"><i /></div>
      </div>
      <Embers from={stage} className="shrine__embers" />
      <div className="shrine__praise">
        <FireBurstButton label="Praise Malacath" said="You praise Malacath." className="shrine__btn shrine__btn--praise" onPress={praise} sound="praise" />
      </div>
      <footer className="page__bar shrine__bar"><Link to="/" className="btn back" onClick={() => sfx('back')}>Back</Link></footer>
      {words.map((w, i) => (
        <div className={`oracle ${w.leaving !== null ? 'is-leaving' : ''}`} key={w.id} role={i === words.length - 1 ? 'status' : undefined} aria-live={i === words.length - 1 ? 'polite' : undefined}>
          <div className="oracle__fog" aria-hidden="true" />
          <div className="oracle__in"><p className="oracle__text">{w.text}</p></div>
        </div>
      ))}
    </div>
  );
}

const TENETS: [string, string, string[]][] = [
  ['I', 'Let No Hidden Hand Shame the Clan', [
    'Do not steal. What is needed must be earned, traded for, asked for, or claimed openly through recognized right, honored oath, lawful challenge, or declared battle.',
    'The hand that steals in shadow weakens the trust of the fire.']],
  ['II', 'Let No Blade Drink Without Warrant', [
    'Do not kill without cause. An Orc may fight, punish, challenge, and make war when the cause is just, but rage alone is not judgment.',
    'A blade drawn only for pride serves the self, not Mauloch.']],
  ['III', 'Let No Oath Fall Broken From the Mouth', [
    'Do not break your oaths. A sworn word is iron pulled from the soul and laid before the fire.',
    'Speak few oaths, but when they are spoken, carry them through blood, shame, hunger, and fear. Let grievances be spoken plainly, for resentment whispered in shadow bears no honor.']],
  ['IV', 'Let the Clan Be Shield, Fire, and Blood', [
    'Protect your clan. Kin are not kept only by birth, but by burden.',
    'Stand for the clan in danger, correct it in dishonor, feed its fire, guard its name, and never leave its weak to be devoured.']],
  ['V', 'Let Hardship Break Upon You, Not Through You', [
    'Endure hardship. The Orsimer are the cursed, the exiled, and the reforged.',
    'Pain may bend the back, hunger may hollow the belly, and grief may darken the eyes, but the Code must remain standing.']],
  ['VI', 'Let No Wrong Remain Unanswered', [
    'Whoever breaks the Code must answer for the harm caused. What was taken must be restored, what was broken must be repaid, and blood unjustly spilled must be answered through goods, service, exile, or blood.',
    'Let the Blood-Price match the wrong, not the anger of the offended. The guilty must not flee their burden, and once the price has been honorably satisfied, the debt shall be ended.']],
  ['VII', 'Let Every Clan Keep Its Fire Without Treachery', [
    'Each clan bears its own name, leadership, customs, and burdens, but all Orc clans stand beneath the gaze of Malacath.',
    'Grievances between clans must be declared openly and answered through council, restitution, challenge, or declared battle. Let no clan weaken another through hidden schemes, false oaths, or unannounced bloodshed.',
    'Conflict faced openly may preserve honor. Treachery poisons every Orcish fire.']],
];

/** The Seven Tenets. Back returns to the Code of Mauloch. */
export function SevenTenets() {
  return (
    <Page title="The Seven Tenets" sub="Code of Mauloch" back="/code">
      <article className="scroll">
        <p className="scroll__lead">
          Though each clan keeps its own fire, bears its own name, and answers to its own leadership, all children of Mauloch
          are bound by the same iron. These tenets name the burdens by which an Orc’s honor shall be measured.
        </p>
        {TENETS.map(([n, name, lines]) => (
          <section className="tenet" key={n}>
            <span className="tenet__num" aria-hidden="true">{n}</span>
            <h2 className="tenet__name">{name}</h2>
            {lines.map((l) => <p key={l}>{l}</p>)}
          </section>
        ))}
      </article>
    </Page>
  );
}
