import { useState, type FormEvent } from 'react';
import { post } from './api.ts';

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
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <form className="card login" onSubmit={submit}>
        <h1>Colima Dashboard</h1>
        {!passwordSet && (
          <p className="banner warn">
            No password set yet. On the host, run <code>npm run set-password</code> in the colima-dashboard folder, then
            restart colima-dashboard.
          </p>
        )}
        <label>
          Password
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="primary" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
