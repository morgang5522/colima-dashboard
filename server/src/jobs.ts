import { randomUUID } from 'node:crypto';

export type JobStatus = 'running' | 'succeeded' | 'failed';

export interface Job {
  id: string;
  profile: string;
  title: string;
  status: JobStatus;
  log: string[];
  error?: string;
  startedAt: number;
  endedAt?: number;
  /** Settles when the job finishes. Not sent to clients. */
  done?: Promise<void>;
}

export function publicJob({ done: _done, ...job }: Job): Omit<Job, 'done'> {
  return job;
}

const MAX_LOG_LINES = 2000;
const KEEP_FINISHED = 20;

/**
 * Runs long VM operations (start/stop/restart/apply settings) in the background,
 * one at a time per profile, and keeps their output so the UI can poll it.
 */
export class JobRunner {
  private jobs = new Map<string, Job>();

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  activeFor(profile: string): Job | undefined {
    return this.list().find((j) => j.profile === profile && j.status === 'running');
  }

  /** Starts a job, or throws if one is already running for this profile. */
  start(profile: string, title: string, work: (log: (line: string) => void) => Promise<void>): Job {
    const active = this.activeFor(profile);
    if (active) throw new JobConflictError(active);
    const job: Job = { id: randomUUID(), profile, title, status: 'running', log: [], startedAt: Date.now() };
    this.jobs.set(job.id, job);
    const log = (line: string) => {
      job.log.push(line);
      if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
    };
    // Returned so tests can await completion; callers normally don't.
    job.done = work(log)
      .then(
        () => {
          job.status = 'succeeded';
        },
        (err: unknown) => {
          job.status = 'failed';
          job.error = err instanceof Error ? err.message : String(err);
          log(`Error: ${job.error}`);
        },
      )
      .finally(() => {
        job.endedAt = Date.now();
        this.prune();
      });
    return job;
  }

  private prune() {
    const finished = this.list().filter((j) => j.status !== 'running');
    for (const j of finished.slice(KEEP_FINISHED)) this.jobs.delete(j.id);
  }
}

export class JobConflictError extends Error {
  readonly job: Job;
  constructor(job: Job) {
    super(`"${job.title}" is still running for ${job.profile}`);
    this.job = job;
  }
}
