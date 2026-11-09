import { useState, type FormEvent } from 'react';
import { api, post, type Host, type Job, type Profile, type VmSettings } from './api.ts';

interface Props {
  profile: Profile;
  host: Host | null;
  selected: boolean;
  onSelect: () => void;
  onChanged: () => Promise<void>;
  onJob: (job: Job) => void;
}

export function ProfileCard({ profile: p, host, selected, onSelect, onChanged, onJob }: Props) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(p.job);

  const lifecycle = async (action: 'start' | 'stop' | 'restart') => {
    if (action !== 'start') {
      const what = action === 'stop' ? 'Stop' : 'Restart';
      if (
        !confirm(
          `${what} the ${p.name} VM? Every container in it goes down${action === 'restart' ? ' until it is back up' : ''}.`,
        )
      ) {
        return;
      }
    }
    setError(null);
    try {
      const { job } = await post<{ job: Job }>(`/api/profiles/${encodeURIComponent(p.name)}/vm/${action}`);
      onJob(job);
    } catch (e) {
      setError((e as Error).message);
    }
    await onChanged();
  };

  const statusClass = busy ? 'busy' : p.running ? 'running' : 'stopped';

  return (
    <article className={`card profile ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="profile-head">
        <h3>{p.name}</h3>
        <span className={`pill pill-${statusClass}`}>{busy ? 'Working…' : p.status}</span>
        {p.brewManaged && (
          <span className="tag" title="Started at login by brew services">
            brew service
          </span>
        )}
      </div>

      <dl className="specs">
        <div>
          <dt>CPUs</dt>
          <dd>{p.current.cpu}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{p.current.memory} GiB</dd>
        </div>
        <div>
          <dt>Disk</dt>
          <dd>{p.current.disk} GiB</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>
            {p.runtime} · {p.arch}
          </dd>
        </div>
      </dl>

      {p.pendingRestart && p.configured && (
        <p className="banner warn small">
          Saved settings ({p.configured.cpu} CPUs, {p.configured.memory} GiB, {p.configured.disk} GiB disk) apply after
          a restart.
        </p>
      )}

      <div className="actions" onClick={(e) => e.stopPropagation()}>
        {p.running ? (
          <>
            <button disabled={busy} onClick={() => lifecycle('stop')}>
              Stop
            </button>
            <button disabled={busy} onClick={() => lifecycle('restart')}>
              Restart
            </button>
          </>
        ) : (
          <button className="primary" disabled={busy} onClick={() => lifecycle('start')}>
            Start
          </button>
        )}
        <button className="ghost" disabled={busy} onClick={() => setEditing((v) => !v)}>
          {editing ? 'Close settings' : 'Settings'}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {editing && (
        <div onClick={(e) => e.stopPropagation()}>
          <SettingsForm
            profile={p}
            host={host}
            onDone={async (job) => {
              setEditing(false);
              if (job) onJob(job);
              await onChanged();
            }}
          />
        </div>
      )}
    </article>
  );
}

function SettingsForm({
  profile: p,
  host,
  onDone,
}: {
  profile: Profile;
  host: Host | null;
  onDone: (job: Job | null) => Promise<void>;
}) {
  const start = p.configured ?? p.current;
  const [values, setValues] = useState<VmSettings>(start);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const maxMem = host ? Math.max(1, host.memoryGiB - 4) : 12;

  const save = async (restart: boolean) => {
    if (restart && !confirm(`Save and restart ${p.name}? Every container in it goes down until it is back up.`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ saved: boolean; job: Job | null }>(
        `/api/profiles/${encodeURIComponent(p.name)}/settings`,
        {
          method: 'PUT',
          body: JSON.stringify({ ...values, restart }),
        },
      );
      await onDone(res.job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(p.running);
  };

  const field = (
    key: keyof VmSettings,
    label: string,
    opts: { min: number; max: number; step: number; unit?: string },
  ) => (
    <label>
      {label}
      <span className="input-unit">
        <input
          type="number"
          inputMode="decimal"
          min={opts.min}
          max={opts.max}
          step={opts.step}
          value={Number.isNaN(values[key]) ? '' : values[key]}
          onChange={(e) => setValues({ ...values, [key]: e.target.valueAsNumber })}
        />
        {opts.unit && <span className="muted">{opts.unit}</span>}
      </span>
    </label>
  );

  return (
    <form className="settings" onSubmit={onSubmit}>
      <div className="settings-grid">
        {field('cpu', 'CPUs', { min: 1, max: host?.cpus ?? 12, step: 1 })}
        {field('memory', 'Memory', { min: 1, max: maxMem, step: 0.5, unit: 'GiB' })}
        {field('disk', 'Disk', { min: start.disk, max: 2048, step: 1, unit: 'GiB' })}
      </div>
      <p className="muted small">
        Changes are written to colima.yaml and only take effect after a full stop and start. Disk can grow but not
        shrink.
        {host &&
          ` This host has ${host.cpus} CPUs and ${host.memoryGiB} GiB; leave room for the host and any other VMs.`}
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="actions">
        {p.running ? (
          <>
            <button className="primary" disabled={saving}>
              Save and restart
            </button>
            <button type="button" disabled={saving} onClick={() => save(false)}>
              Save only
            </button>
          </>
        ) : (
          <button className="primary" disabled={saving}>
            Save
          </button>
        )}
      </div>
    </form>
  );
}
