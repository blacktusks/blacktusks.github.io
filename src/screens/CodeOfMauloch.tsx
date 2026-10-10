import { Page } from '../components/ui';

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

export default function CodeOfMauloch() {
  return (
    <Page title="Code of Mauloch" sub="The Seven Tenets">
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
