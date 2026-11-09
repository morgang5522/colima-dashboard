import { Minus, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, type Host, type Job, type Profile, type VmSettings } from './api.ts';
import { Spinner } from './ui/Spinner.tsx';

interface Props {
  profile: Profile;
  host: Host | null;
  onCancel: () => void;
  onSaved: (job: Job | null, message: string) => Promise<void>;
}

export function SettingsForm({ profile: p, host, onCancel, onSaved }: Props) {
  const start = p.configured ?? p.current;
  const [values, setValues] = useState<VmSettings>(start);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'restart' | 'later' | null>(null);
  const maxCpu = host?.cpus ?? 16;
  const maxMem = host ? Math.max(1, host.memoryGiB - 4) : 16;
  const changed = values.cpu !== start.cpu || values.memory !== start.memory || values.disk !== start.disk;

  const save = async (restart: boolean) => {
    setSaving(restart ? 'restart' : 'later');
    setError(null);
    try {
      const res = await api<{ saved: boolean; job: Job | null }>(
        `/api/profiles/${encodeURIComponent(p.name)}/settings`,
        { method: 'PUT', body: JSON.stringify({ ...values, restart }) },
      );
      await onSaved(res.job, p.running ? `Saved. ${p.name} picks this up on its next restart.` : `Saved ${p.name}.`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(p.running);
  };

  return (
    <form className="settings" onSubmit={onSubmit}>
      <p className="popover-title">Resources for {p.name}</p>

      <Stepper
        label="CPU"
        unit={values.cpu === 1 ? 'core' : 'cores'}
        hint={`of ${maxCpu}`}
        value={values.cpu}
        min={1}
        max={maxCpu}
        step={1}
        onChange={(cpu) => setValues({ ...values, cpu })}
      />
      <Stepper
        label="Memory"
        unit="GiB"
        hint={host ? `of ${host.memoryGiB}` : undefined}
        value={values.memory}
        min={1}
        max={maxMem}
        step={0.5}
        onChange={(memory) => setValues({ ...values, memory })}
      />
      <Stepper
        label="Disk"
        unit="GiB"
        hint="grow only"
        value={values.disk}
        min={start.disk}
        max={2048}
        step={10}
        onChange={(disk) => setValues({ ...values, disk })}
      />

      <p className="settings-note">
        {p.running
          ? 'New resources take effect after a full stop and start. Containers are down while the VM restarts.'
          : 'New resources take effect the next time the VM starts.'}
      </p>
      {error && <p className="field-error">{error}</p>}

      <div className="confirm-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        {p.running && (
          <button type="button" className="btn" disabled={!changed || saving !== null} onClick={() => void save(false)}>
            {saving === 'later' && <Spinner />}
            Save for later
          </button>
        )}
        <button className="btn btn-primary" disabled={!changed || saving !== null}>
          {saving === 'restart' && <Spinner />}
          {p.running ? 'Save and restart' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function Stepper(props: {
  label: string;
  unit: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  const { label, unit, hint, value, min, max, step, onChange } = props;
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  const id = `stepper-${label.toLowerCase()}`;
  return (
    <div className="stepper">
      <label htmlFor={id} className="stepper-label">
        {label}
        {hint && <span>{hint}</span>}
      </label>
      <div className="stepper-control">
        <button
          type="button"
          aria-label={`Less ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
        >
          <Minus size={14} />
        </button>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={Number.isNaN(value) ? '' : value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          onBlur={() => !Number.isNaN(value) && onChange(clamp(value))}
        />
        <span className="stepper-unit">{unit}</span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + step))}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
