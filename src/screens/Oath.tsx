import { useAuth } from '../lib/auth';
import { useClanScreen, type Clan } from '../lib/clan';
import { Page } from '../components/ui';

// The Scorned Oath, as the Scorned wrote it. It names no one: there is no place for the member's name.
const SCORNED_OATH = [
  'By Malacath and the Ashen Forge,',
  'I am Scorned.',
  'My blood is the clan’s.',
  'My soul belongs to our lord Malacath.',
  'My strength answers the Chieftain.',
  'His will is my command.',
  'I rise and fall at his order.',
  'Should I fail this oath, my life shall be forfeit, as is my place in the Ashen Forge should I fall…',
];

export default function Oath({ clan = 'black_tusks' }: { clan?: Clan }) {
  useClanScreen(clan);
  const { profile } = useAuth();
  if (clan === 'scorned') {
    return (
      <Page title="Scorned Oath">
        <article className="oath oath--lines">
          {SCORNED_OATH.map((line) => <p key={line}>{line}</p>)}
          <img className="oath__seal oath__seal--scorned" src="./img/scorned-seal.webp" alt="" />
        </article>
      </Page>
    );
  }
  return (
    <Page title="Black Tusk Oath">
      <article className="oath">
        <p>
          By Mauloch, father of the spurned, I <span className="oath__name">{profile?.display_name ?? 'your name'}</span> give
          my life to the Black Tusk. Not my axe for a season, not my strength for a war. My life, whole and until its end.
          Your fire is the only fire I tend. Your chief is the only chief I bow to. Where the clan goes I go; where it
          falls I fall. Let no other banner, no gold, no soft bed pull me from this. If I forsake it, let Mauloch strike
          my name from the ancestors, that I wander godless past death. This is my life, given. The Orc-Father has heard.
        </p>
        <img className="oath__seal" src="./img/blacktusk-seal.png" alt="" />
      </article>
    </Page>
  );
}
