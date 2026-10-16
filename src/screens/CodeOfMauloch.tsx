import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page, useTitle } from '../components/ui';
import { Embers } from '../components/Embers';
import { FireBurstButton } from '../components/FireBurst';
import { MALACATH_WORDS } from '../lib/malacath';

/** How long one of Malacath's sayings is on screen: 1.6 s rising out of the fog, 10 s held, 2.4 s sinking back. */
export const WORD_MS = 14000;

/** Any saying but the last one. */
export function pickWord(last: number, count: number, rnd = Math.random): number {
  if (count < 2 || last < 0 || last >= count) return Math.floor(rnd() * count);
  const i = Math.floor(rnd() * (count - 1));
  return i >= last ? i + 1 : i;
}

/**
 * The Code of Mauloch: the way to the Seven Tenets, and Malacath's shrine. Praise him and green hands
 * rise in fire, and one of his sayings comes up out of the fog behind the statue. Only one is spoken at
 * a time: praise him again while he speaks and the fire answers, but his words wait for the fog to clear.
 */
export default function CodeOfMauloch() {
  useTitle('Code of Mauloch');
  const go = useNavigate();
  const stage = useRef<HTMLDivElement>(null);
  const [word, setWord] = useState<{ text: string; id: number } | null>(null);
  const last = useRef(-1); const speaking = useRef(false); const count = useRef(0); const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const praise = () => {
    if (speaking.current) return;
    speaking.current = true;
    const i = pickWord(last.current, MALACATH_WORDS.length); last.current = i;
    setWord({ text: MALACATH_WORDS[i], id: ++count.current });
    timer.current = window.setTimeout(() => { speaking.current = false; setWord(null); }, WORD_MS);
  };
  return (
    <div className="shrine">
      <header className="shrine__head">
        <h1 className="page__title">Code of Mauloch</h1>
        <p className="page__sub">The way of the Orsimer</p>
      </header>
      <nav className="shrine__nav" aria-label="Code of Mauloch">
        <button className="shrine__btn" onClick={() => go('/code/tenets')}>The Seven Tenets</button>
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
        <FireBurstButton label="Praise Malacath" said="You praise Malacath." className="shrine__btn shrine__btn--praise" onPress={praise} />
      </div>
      <footer className="page__bar shrine__bar"><Link to="/" className="btn back">Back</Link></footer>
      {word && (
        <div className="oracle" key={word.id} role="status" aria-live="polite">
          <div className="oracle__fog" aria-hidden="true" />
          <div className="oracle__in"><p className="oracle__text">{word.text}</p></div>
        </div>
      )}
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
