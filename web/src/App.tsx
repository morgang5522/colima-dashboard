import { useCallback, useEffect, useState } from 'react';
import { api, post, type Host, type Job, type Profile } from './api.ts';
import { Containers } from './Containers.tsx';
import { Login } from './Login.tsx';
import { ProfileCard } from './ProfileCard.tsx';

type SessionState = 'loading' | 'signed-out' | 'signed-in';

export function App() {
  const [session, setSession] = useState<SessionState>('loading');
  const [passwordSet, setPasswordSet] = useState(true);

  const checkSession = useCallback(async () => {
    const s = await api<{ authenticated: boolean; passwordSet: boolean }>('/api/session');
    setPasswordSet(s.passwordSet);
    setSession(s.authenticated ? 'signed-in' : 'signed-out');
  }, []);

  useEffect(() => {
    void checkSession();
    const onSignedOut = () => setSession('signed-out');
    window.addEventListener('colima-dashboard:signed-out', onSignedOut);
    return () => window.removeEventListener('colima-dashboard:signed-out', onSignedOut);
  }, [checkSession]);

  if (session === 'loading') return <div className="centered muted">Loading…</div>;
  if (session === 'signed-out') return <Login passwordSet={passwordSet} onSignedIn={() => setSession('signed-in')} />;
  return <Dashboard onSignOut={() => setSession('signed-out')} />;
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [host, setHost] = useState<Host | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<Job | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api<Profile[]>('/api/profiles');
      setProfiles(list);
      setError(null);
      setSelected((s) => (s && list.some((p) => p.name === s) ? s : (list[0]?.name ?? null)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void api<Host>('/api/host').then(setHost, () => {});
  }, []);

  // Poll faster while a VM operation is running.
  const busy = Boolean(profiles?.some((p) => p.job));
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), busy ? 2000 : 8000);
    return () => clearInterval(t);
  }, [refresh, busy]);

  // Keep showing a job's output after it finishes, until the next one starts.
  useEffect(() => {
    const active = profiles?.find((p) => p.job)?.job;
    if (active) setLastJob(active);
    else if (lastJob?.status === 'running') {
      void api<Job>(`/api/jobs/${lastJob.id}`).then(setLastJob, () => {});
    }
  }, [profiles, lastJob]);

  const signOut = async () => {
    await post('/api/logout').catch(() => {});
    onSignOut();
  };

  const current = profiles?.find((p) => p.name === selected) ?? null;

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ▣
          </span>
          Colima Dashboard
        </div>
        {host && (
          <span className="muted small hide-narrow">
            Host: {host.cpus} CPUs · {host.memoryGiB} GiB
          </span>
        )}
        <button className="ghost" onClick={signOut}>
          Sign out
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}

      <main>
        <section>
          <h2 className="section-title">VMs</h2>
          {profiles === null ? (
            <p className="muted">Loading profiles…</p>
          ) : profiles.length === 0 ? (
            <p className="muted">No Colima profiles found.</p>
          ) : (
            <div className="profiles">
              {profiles.map((p) => (
                <ProfileCard
                  key={p.name}
                  profile={p}
                  host={host}
                  selected={p.name === selected}
                  onSelect={() => setSelected(p.name)}
                  onChanged={refresh}
                  onJob={setLastJob}
                />
              ))}
            </div>
          )}
          {lastJob && <JobPanel job={lastJob} onClose={() => setLastJob(null)} />}
        </section>

        {current && (
          <section>
            <h2 className="section-title">
              Containers <span className="muted">in {current.name}</span>
            </h2>
            {current.running && !current.job && current.runtime !== 'docker' ? (
              <p className="muted">
                Containers are only shown for the docker runtime ({current.name} uses {current.runtime}).
              </p>
            ) : current.running && !current.job ? (
              <Containers profile={current.name} />
            ) : (
              <p className="muted">
                {current.job ? `${current.job.title} in progress…` : 'Start the VM to see its containers.'}
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function JobPanel({ job, onClose }: { job: Job; onClose: () => void }) {
  const label = { running: 'Running', succeeded: 'Done', failed: 'Failed' }[job.status];
  return (
    <div className={`job job-${job.status}`}>
      <div className="job-head">
        <strong>{job.title}</strong>
        <span className={`pill pill-${job.status}`}>{label}</span>
        {job.status !== 'running' && (
          <button className="ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <pre
        className="job-log"
        ref={(el) => {
          if (el) el.scrollTop = el.scrollHeight;
        }}
      >
        {job.log.join('\n') || 'Starting…'}
      </pre>
    </div>
  );
}
