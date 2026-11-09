import { LogOut } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, post, type Host, type Job, type Profile } from './api.ts';
import { Containers } from './Containers.tsx';
import { JobConsole } from './JobConsole.tsx';
import { Login } from './Login.tsx';
import { Logo } from './Logo.tsx';
import { MachineCard } from './MachineCard.tsx';
import { ToastProvider } from './ui/Toasts.tsx';
import { IconButton } from './ui/Tooltip.tsx';

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

  if (session === 'loading') return null;
  if (session === 'signed-out') return <Login passwordSet={passwordSet} onSignedIn={() => setSession('signed-in')} />;
  return (
    <ToastProvider>
      <Dashboard onSignOut={() => setSession('signed-out')} />
    </ToastProvider>
  );
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
    const t = setInterval(() => void refresh(), busy ? 1500 : 8000);
    return () => clearInterval(t);
  }, [refresh, busy]);

  // Keep a job's output on screen after it finishes, until it's dismissed or another starts.
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
  const several = (profiles?.length ?? 0) > 1;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">
          <Logo />
          <span>colima</span>
        </div>
        {host && (
          <div className="host-facts">
            <span>{host.cpus} cores</span>
            <span>{host.memoryGiB} GiB</span>
          </div>
        )}
        <IconButton label="Sign out" placement="bottom-end" onClick={signOut}>
          <LogOut size={16} />
        </IconButton>
      </header>

      {error && <div className="notice notice-error">{error}</div>}

      <section aria-label="Virtual machines" className="machines">
        {profiles?.length === 0 && (
          <div className="empty">
            No Colima VMs yet. Create one with <code>colima start</code>.
          </div>
        )}
        {profiles?.map((p) => (
          <MachineCard
            key={p.name}
            profile={p}
            host={host}
            selectable={several}
            selected={several && p.name === selected}
            onSelect={() => setSelected(p.name)}
            onChanged={refresh}
            onJob={setLastJob}
          />
        ))}
        {lastJob && <JobConsole job={lastJob} onDismiss={() => setLastJob(null)} />}
      </section>

      {current && (
        <section aria-label="Containers" className="containers-section">
          <div className="section-head">
            <h2>Containers</h2>
            {several && <span className="section-sub">{current.name}</span>}
          </div>
          {current.job ? (
            <div className="empty">Waiting for {current.job.title.toLowerCase()} to finish.</div>
          ) : !current.running ? (
            <div className="empty">{current.name} is stopped. Start it to see its containers.</div>
          ) : current.runtime !== 'docker' ? (
            <div className="empty">
              Containers are only listed for the docker runtime. {current.name} uses {current.runtime}.
            </div>
          ) : (
            <Containers profile={current.name} />
          )}
        </section>
      )}
    </div>
  );
}
