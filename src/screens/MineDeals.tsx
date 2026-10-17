import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { CLAN, canKeepMine, useClanScreen, type Clan } from '../lib/clan';
import { Board } from '../components/Board';
import { Page } from '../components/ui';

const SUB: Record<Clan, string> = {
  black_tusks: 'Authorized deals for the mines within Largashbur',
  scorned: 'Authorized deals for Gloombound Mine',
};

/** Each clan's mine, kept by that clan's officers (Chieftain, Right Tusk, Left Tusk, Wise Woman). The Forgemaster keeps
 *  both. Every member reads the open deals of either. */
export default function MineDeals({ clan = 'black_tusks' }: { clan?: Clan }) {
  useClanScreen(clan);
  const { profile } = useAuth(); const keeper = canKeepMine(profile, clan);
  const [composing, setComposing] = useState(false);
  return (
    <Page title={CLAN[clan].mine} sub={SUB[clan]} width="wide"
      bar={keeper && <button className="btn btn--go" onClick={() => setComposing(true)}>Add a deal</button>}>
      <Board key={clan} table="mine_deals" clan={clan} canWrite={keeper} noun="deal" composing={composing} onComposeDone={() => setComposing(false)}
        empty={keeper ? 'No deals are on record. Add the first one.' : 'No deals are on record for you to see.'} />
    </Page>
  );
}
