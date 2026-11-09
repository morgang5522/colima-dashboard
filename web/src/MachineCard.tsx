import { Play, RotateCw, SlidersHorizontal, Square } from 'lucide-react';
import { post, type Host, type Job, type Profile } from './api.ts';
import { SettingsForm } from './SettingsForm.tsx';
import { Confirm } from './ui/Confirm.tsx';
import { Popover } from './ui/Popover.tsx';
import { Spinner } from './ui/Spinner.tsx';
import { useToast } from './ui/Toasts.tsx';

interface Props {
  profile: Profile;
  host: Host | null;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  onChanged: () => Promise<void>;
  onJob: (job: Job) => void;
}

export function MachineCard({ profile: p, host, selectable, selected, onSelect, onChanged, onJob }: Props) {
  const toast = useToast();
  const busy = Boolean(p.job);
  const state = busy ? 'busy' : p.running ? 'running' : 'stopped';

  const lifecycle = async (action: 'start' | 'stop' | 'restart') => {
    try {
      const { job } = await post<{ job: Job }>(`/api/profiles/${encodeURIComponent(p.name)}/vm/${action}`);
      onJob(job);
    } catch (e) {
      toast.error((e as Error).message);
    }
    await onChanged();
  };

  const downtime = p.brewManaged
    ? 'Every container in it goes down. It is stopped through brew services, so it stays down until you start it here.'
    : 'Every container in it goes down.';

  return (
    <article
      className={`machine machine-${state} ${selectable ? 'machine-selectable' : ''} ${selected ? 'machine-selected' : ''}`}
      onClick={selectable ? onSelect : undefined}
      aria-current={selected || undefined}
    >
      <div className="machine-main">
        <div className="machine-id">
          <span className={`led led-${state}`} aria-hidden />
          <h2 className="machine-name">{p.name}</h2>
          <span className="machine-state">
            {busy ? (
              <>
                <Spinner size={12} /> {progressLabel(p.job!.title)}
              </>
            ) : (
              p.status.toLowerCase()
            )}
          </span>
        </div>
        <div className="machine-tags">
          <span>{p.runtime}</span>
          <span>{p.arch}</span>
          {p.brewManaged && <span title="Started at login by brew services">brew service</span>}
        </div>
      </div>

      <div className="machine-resources">
        <Meter label="CPU" value={p.current.cpu} max={host?.cpus} unit={p.current.cpu === 1 ? 'core' : 'cores'} />
        <Meter label="Memory" value={p.current.memory} max={host?.memoryGiB} unit="GiB" />
        <Meter label="Disk" value={p.current.disk} unit="GiB" />
      </div>

      <div className="machine-actions" onClick={(e) => e.stopPropagation()}>
        {p.running ? (
          <>
            <Confirm
              title={`Restart ${p.name}?`}
              body={<p>Containers go down until the VM is back up, usually under a minute.</p>}
              confirmLabel="Restart"
              onConfirm={() => lifecycle('restart')}
            >
              <button type="button" className="btn" disabled={busy}>
                <RotateCw size={14} />
                Restart
              </button>
            </Confirm>
            <Confirm
              title={`Stop ${p.name}?`}
              body={<p>{downtime}</p>}
              confirmLabel="Stop VM"
              tone="danger"
              onConfirm={() => lifecycle('stop')}
            >
              <button type="button" className="btn" disabled={busy}>
                <Square size={13} />
                Stop
              </button>
            </Confirm>
          </>
        ) : (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void lifecycle('start')}>
            <Play size={14} />
            Start
          </button>
        )}
        <Popover
          className="popover-settings"
          content={(close) => (
            <SettingsForm
              profile={p}
              host={host}
              onCancel={close}
              onSaved={async (job, message) => {
                close();
                if (job) onJob(job);
                else toast.success(message);
                await onChanged();
              }}
            />
          )}
        >
          <button type="button" className="btn" disabled={busy} aria-label="Resources">
            <SlidersHorizontal size={14} />
            <span className="hide-sm">Resources</span>
          </button>
        </Popover>
      </div>

      {p.pendingRestart && p.configured && !busy && (
        <div className="machine-pending" onClick={(e) => e.stopPropagation()}>
          <span>
            Saved: {p.configured.cpu} cores, {p.configured.memory} GiB memory, {p.configured.disk} GiB disk. Applies on
            the next restart.
          </span>
          <Confirm
            title={`Restart ${p.name} now?`}
            body={<p>Containers go down until the VM is back up with the new resources.</p>}
            confirmLabel="Restart"
            onConfirm={() => lifecycle('restart')}
          >
            <button type="button" className="link-btn">
              Restart now
            </button>
          </Confirm>
        </div>
      )}
    </article>
  );
}

const PROGRESS: Record<string, string> = {
  Start: 'starting',
  Stop: 'stopping',
  Restart: 'restarting',
  Apply: 'applying resources',
};

function progressLabel(jobTitle: string): string {
  return PROGRESS[jobTitle.split(' ')[0] ?? ''] ?? 'working';
}

function Meter({ label, value, max, unit }: { label: string; value: number; max?: number; unit: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : null;
  return (
    <div className="meter">
      <div className="meter-label">{label}</div>
      <div className="meter-value">
        {value} <span>{unit}</span>
        {max !== undefined && <span className="meter-of">/ {max}</span>}
      </div>
      {pct !== null && (
        <div className="meter-track" aria-hidden>
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
