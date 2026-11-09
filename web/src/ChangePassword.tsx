import { useState, type FormEvent } from 'react';
import { ApiError, post } from './api.ts';
import { Spinner } from './ui/Spinner.tsx';

const MIN_LENGTH = 8;

type Field = 'current' | 'next' | 'repeat';

export function ChangePasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [values, setValues] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState<{ field: Field | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues({ ...values, [field]: e.target.value });
    if (error?.field === field) setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (values.next.length < MIN_LENGTH) {
      setError({ field: 'next', message: `Use at least ${MIN_LENGTH} characters.` });
      return;
    }
    if (values.next !== values.repeat) {
      setError({ field: 'repeat', message: "The new passwords don't match." });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await post('/api/password', { current: values.current, next: values.next });
      onDone();
    } catch (err) {
      const field = err instanceof ApiError ? (err.field as Field | undefined) : undefined;
      setError({ field: field ?? null, message: (err as Error).message });
      setSaving(false);
    }
  };

  const input = (field: Field, label: string, autoComplete: string, autoFocus = false) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="password"
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        value={values[field]}
        aria-invalid={error?.field === field}
        onChange={set(field)}
      />
      {error?.field === field && <span className="field-error">{error.message}</span>}
    </label>
  );

  return (
    <form className="settings password-form" onSubmit={submit}>
      <p className="popover-title">Change password</p>
      {input('current', 'Current password', 'current-password', true)}
      {input('next', 'New password', 'new-password')}
      {input('repeat', 'New password again', 'new-password')}
      {error && error.field === null && <p className="field-error">{error.message}</p>}
      <p className="settings-note">
        At least {MIN_LENGTH} characters. Other browsers signed in to this dashboard are signed out.
      </p>
      <div className="confirm-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={saving || !values.current || !values.next || !values.repeat}>
          {saving && <Spinner />}
          Change password
        </button>
      </div>
    </form>
  );
}
