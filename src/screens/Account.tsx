import { useState } from 'react';
import { api } from '../lib/supabase';
import { Modal } from '../components/ui';

/** Change your own password. `forced` is the first sign-in with a temporary one. */
export function ChangePassword({ forced, onDone, onClose }: { forced?: boolean; onDone: () => void; onClose?: () => void }) {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (next.length < 8) return setError('Use at least 8 characters.');
    if (next !== again) return setError('The two new passwords do not match.');
    setBusy(true);
    try { await api('account.change_password', { current_password: current, new_password: next }); setSaved(true); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  if (saved) {
    return (
      <Modal title="Password changed" foot={<button className="btn btn--go" onClick={onDone}>Continue</button>}>
        <p>Your new password is saved. Use it the next time you sign in.</p>
      </Modal>
    );
  }
  return (
    <Modal title={forced ? 'Choose your own password' : 'Change password'} onClose={forced ? undefined : onClose}>
      <form onSubmit={submit}>
        {forced && <p style={{ marginBottom: 14 }}>You signed in with a temporary password. Pick one of your own before going further.</p>}
        <label className="field"><span>{forced ? 'Temporary password' : 'Current password'}</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="field"><span>New password</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        <label className="field"><span>New password again</span>
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        <p className="note">The Forgemaster can read this password to help you if you forget it. Use one you do not use anywhere else.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row row--end" style={{ marginTop: 14 }}>
          {!forced && <button type="button" className="btn" onClick={onClose}>Cancel</button>}
          <button className="btn btn--go" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </div>
      </form>
    </Modal>
  );
}
