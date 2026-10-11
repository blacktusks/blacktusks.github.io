import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { CONFIGURED } from './config';
import { useAuth } from './lib/auth';
import { onUpdateReady, reloadIntoUpdate } from './lib/update';
import MainMenu from './screens/MainMenu';
import SignIn from './screens/SignIn';
import CodeOfMauloch from './screens/CodeOfMauloch';
import Oath from './screens/Oath';
import { ChangePassword } from './screens/Account';
import { Scene } from './components/Scene';
import { ErrorBoundary } from './components/ErrorBoundary';

const NoticeBoard = lazy(() => import('./screens/NoticeBoard'));
const Members = lazy(() => import('./screens/Members'));
const MineDeals = lazy(() => import('./screens/MineDeals'));
const Expansion = lazy(() => import('./screens/Expansion'));
const MiningMap = lazy(() => import('./screens/MiningMap'));
const Ledger = lazy(() => import('./screens/Ledger'));

function Loading() {
  return (<><Scene quiet /><div className="page"><p className="empty" style={{ marginTop: '40vh' }}>Stoking the fire…</p></div></>);
}

function MembersOnly({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (!profile) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

/** Shown only when a new build arrived while someone was mid-task. */
function UpdateBar() {
  const [ready, setReady] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  if (!ready) return null;
  return (
    <div className="updatebar" role="status">
      <span>A newer version of the app is ready.</span>
      <button className="btn btn--small btn--go" onClick={reloadIntoUpdate}>Reload</button>
    </div>
  );
}

export default function App() {
  const { ready, profile, reload } = useAuth();
  if (!CONFIGURED) {
    return (<><Scene quiet /><div className="page"><div className="page__body"><div className="panel" style={{ marginTop: '20vh' }}>
      <div className="panel__head"><span className="panel__title">The app is not connected yet</span></div>
      <div className="panel__body"><p>Add your Supabase project URL and anon key to <code>.env.production</code> (see <code>.env.example</code>), then build again.</p></div>
    </div></div></div></>);
  }
  if (!ready) return <Loading />;
  return (
    <ErrorBoundary>
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<MainMenu />} />
        <Route path="/sign-in" element={profile ? <Navigate to="/" replace /> : <SignIn />} />
        <Route path="/code" element={<CodeOfMauloch />} />
        <Route path="/notices" element={<MembersOnly><NoticeBoard /></MembersOnly>} />
        <Route path="/oath" element={<MembersOnly><Oath /></MembersOnly>} />
        <Route path="/members" element={<MembersOnly><Members /></MembersOnly>} />
        <Route path="/mine" element={<MembersOnly><MineDeals /></MembersOnly>} />
        <Route path="/expansion" element={<MembersOnly><Expansion /></MembersOnly>} />
        <Route path="/map" element={<MembersOnly><MiningMap /></MembersOnly>} />
        <Route path="/ledger" element={<MembersOnly><Ledger /></MembersOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {profile?.must_change_password && <ChangePassword forced onDone={reload} />}
      <UpdateBar />
    </Suspense>
    </ErrorBoundary>
  );
}
