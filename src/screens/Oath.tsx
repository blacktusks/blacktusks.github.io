import { useAuth } from '../lib/auth';
import { Page } from '../components/ui';

export default function Oath() {
  const { profile } = useAuth();
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
        <img className="oath__seal" src="./icons/icon-192.png" alt="" />
      </article>
    </Page>
  );
}
