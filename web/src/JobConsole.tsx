import { ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Job } from './api.ts';
import { Spinner } from './ui/Spinner.tsx';
import { IconButton } from './ui/Tooltip.tsx';

/** Live output of a VM operation. Collapses itself a few seconds after succeeding. */
export function JobConsole({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setOpen(true);
  }, [job.id]);

  useEffect(() => {
    if (job.status === 'succeeded') {
      const t = setTimeout(() => setOpen(false), 4000);
      return () => clearTimeout(t);
    }
    if (job.status === 'failed') setOpen(true);
  }, [job.status]);

  useEffect(() => {
    if (job.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  const seconds = Math.round(((job.endedAt ?? now) - job.startedAt) / 1000);
  const state = { running: 'Running', succeeded: 'Finished', failed: 'Failed' }[job.status];

  return (
    <div className={`console console-${job.status}`}>
      <div className="console-head">
        <button type="button" className="console-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ChevronRight size={14} className={`chevron ${open ? 'chevron-open' : ''}`} />
          {job.status === 'running' && <Spinner size={13} />}
          <span className="console-title">{job.title}</span>
          <span className="console-state">
            {state} · {seconds}s
          </span>
        </button>
        {job.status !== 'running' && (
          <IconButton label="Dismiss" onClick={onDismiss}>
            <X size={15} />
          </IconButton>
        )}
      </div>
      {open && (
        <pre
          className="console-output"
          ref={(el) => {
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          {job.log.join('\n') || 'Starting'}
        </pre>
      )}
    </div>
  );
}
