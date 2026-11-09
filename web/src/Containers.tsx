import { useCallback, useEffect, useState } from 'react';
import { api, post, type Container, type ProjectGroup } from './api.ts';
import { LogViewer } from './LogViewer.tsx';

type Action = 'start' | 'stop' | 'restart';

export function Containers({ profile }: { profile: string }) {
  const [groups, setGroups] = useState<ProjectGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [logsFor, setLogsFor] = useState<Container | null>(null);
  const base = `/api/profiles/${encodeURIComponent(profile)}`;

  const refresh = useCallback(async () => {
    try {
      setGroups(await api<ProjectGroup[]>(`${base}/containers`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (key: string, path: string, label: string, needsConfirm: boolean) => {
    if (needsConfirm && !confirm(label)) return;
    setPending((s) => new Set(s).add(key));
    try {
      await post(path);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
      await refresh();
    }
  };

  const containerAction = (c: Container, action: Action) =>
    act(c.id, `${base}/containers/${c.id}/${action}`, `${cap(action)} ${c.name}?`, action === 'stop');

  const projectAction = (project: string, action: Action) =>
    act(
      `project:${project}`,
      `${base}/projects/${encodeURIComponent(project)}/${action}`,
      `${cap(action)} every container in ${project}?`,
      action !== 'start',
    );

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  if (groups === null) return <p className="muted">{error ?? 'Loading containers…'}</p>;

  const q = filter.trim().toLowerCase();
  const visible = groups
    .map((g) => ({
      ...g,
      containers: q
        ? g.containers.filter((c) => [c.name, c.image, g.project ?? ''].some((s) => s.toLowerCase().includes(q)))
        : g.containers,
    }))
    .filter((g) => g.containers.length > 0);

  return (
    <div className="containers">
      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter by name, image or project"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="ghost" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {visible.length === 0 && <p className="muted">No containers{q ? ' match' : ''}.</p>}

      {visible.map((g) => {
        const key = g.project ?? '__standalone';
        const isCollapsed = collapsed.has(key);
        const busy = pending.has(`project:${g.project}`);
        return (
          <div className="card group" key={key}>
            <div className="group-head">
              <button className="ghost disclosure" onClick={() => toggle(key)} aria-expanded={!isCollapsed}>
                {isCollapsed ? '▸' : '▾'}
              </button>
              <div className="group-title" onClick={() => toggle(key)}>
                <strong>{g.project ?? 'Standalone containers'}</strong>
                <span className="muted small">
                  {g.running}/{g.total} running
                  {g.workingDir && <span className="hide-narrow"> · {g.workingDir}</span>}
                </span>
              </div>
              {g.project && (
                <div className="actions compact">
                  <button
                    className="small"
                    disabled={busy || g.running === g.total}
                    onClick={() => projectAction(g.project!, 'start')}
                  >
                    Start all
                  </button>
                  <button
                    className="small"
                    disabled={busy || g.running === 0}
                    onClick={() => projectAction(g.project!, 'stop')}
                  >
                    Stop all
                  </button>
                  <button className="small" disabled={busy} onClick={() => projectAction(g.project!, 'restart')}>
                    Restart all
                  </button>
                </div>
              )}
            </div>

            {!isCollapsed && (
              <ul className="rows">
                {g.containers.map((c) => {
                  const running = c.state === 'running';
                  const rowBusy = busy || pending.has(c.id);
                  return (
                    <li key={c.id} className="row">
                      <span className={`dot dot-${c.state}`} title={c.state} />
                      <div className="row-main">
                        <div className="row-name">{c.service ?? c.name}</div>
                        <div className="muted small ellipsis">
                          {c.status} · {c.image}
                        </div>
                        {c.ports.length > 0 && (
                          <div className="ports">
                            {c.ports.map((p) => (
                              <code key={p}>{p}</code>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="actions compact">
                        <button className="small" onClick={() => setLogsFor(c)}>
                          Logs
                        </button>
                        {running ? (
                          <>
                            <button className="small" disabled={rowBusy} onClick={() => containerAction(c, 'restart')}>
                              Restart
                            </button>
                            <button className="small" disabled={rowBusy} onClick={() => containerAction(c, 'stop')}>
                              Stop
                            </button>
                          </>
                        ) : (
                          <button
                            className="small primary"
                            disabled={rowBusy}
                            onClick={() => containerAction(c, 'start')}
                          >
                            Start
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      {logsFor && <LogViewer profile={profile} container={logsFor} onClose={() => setLogsFor(null)} />}
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
