import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { isOfficer } from '../lib/roles';
import { Board } from '../components/Board';
import { Page } from '../components/ui';

export default function MineDeals() {
  const { profile } = useAuth(); const officer = isOfficer(profile!.tags);
  const [composing, setComposing] = useState(false);
  return (
    <Page title="Mine of the Black Tusks" sub="Authorized deals for the mines within Largashbur" width="wide"
      bar={officer && <button className="btn btn--go" onClick={() => setComposing(true)}>Add a deal</button>}>
      <Board table="mine_deals" canWrite={officer} noun="deal" composing={composing} onComposeDone={() => setComposing(false)}
        empty={officer ? 'No deals are on record. Add the first one.' : 'No deals are on record for you to see.'} />
    </Page>
  );
}
