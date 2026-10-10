import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Scene } from '../components/Scene';

export default function SignIn() {
  const { signIn } = useAuth();
  const go = useNavigate();
  const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { await signIn(name, password); go('/', { replace: true }); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Scene quiet />
      <div className="page" style={{ justifyContent: 'center' }}>
        <form className="modal__box" style={{ margin: 'auto' }} onSubmit={submit} aria-label="Sign in">
          <div className="modal__head">Sign In</div>
          <div className="modal__body">
            <label className="field"><span>Name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" spellCheck={false} required />
            </label>
            <label className="field"><span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <p className="hint">Accounts are made by the clan's officers. If you have no name and password yet, ask one of them.</p>
          </div>
          <div className="modal__foot">
            <Link to="/" className="btn back">Back</Link>
            <button className="btn btn--go" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
