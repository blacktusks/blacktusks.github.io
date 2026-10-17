// The fallen: members whose characters have died. The same list as Members, over those who carry the Deceased tag,
// one list for each clan.
import { useClanScreen, type Clan } from '../lib/clan';
import { Roster } from './Members';

export default function Deceased({ clan = 'black_tusks' }: { clan?: Clan }) {
  useClanScreen(clan);
  return <Roster fallen clan={clan} key={clan} />;
}
