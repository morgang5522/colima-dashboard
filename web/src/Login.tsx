import { useState, type FormEvent } from 'react';
import { post } from './api.ts';
import { Logo } from './Logo.tsx';
import { Spinner } from './ui/Spinner.tsx';

export function Login({ passwordSet, onSignedIn }: { passwordSet: boolean; onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/login', { password });
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login" onSubmit={submit}>
        <div className="wordmark wordmark-large">
          <Logo size={26} />
          <span>colima</span>
        </div>
        {!passwordSet ? (
          <p className="notice notice-warn">
            Set a password first: run <code>npm run set-password</code> in the colima-dashboard folder on the host, then
            restart it.
          </p>
        ) : (
          <>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                aria-invalid={Boolean(error)}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <p className="field-error">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy || !password}>
              {busy && <Spinner />}
              Sign in
            </button>
          </>
        )}
      </form>
    </main>
  );
}
