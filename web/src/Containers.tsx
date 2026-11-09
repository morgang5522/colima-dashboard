import { ChevronRight, Ellipsis, Play, RefreshCw, RotateCw, ScrollText, Search, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, post, type Container, type ProjectGroup } from './api.ts';
import { LogDrawer } from './LogDrawer.tsx';
import { Confirm } from './ui/Confirm.tsx';
import { Menu } from './ui/Menu.tsx';
import { useToast } from './ui/Toasts.tsx';
import { IconButton } from './ui/Tooltip.tsx';

type Action = 'start' | 'stop' | 'restart';
type Filter = 'all' | 'running' | 'stopped';

const PAST: Record<Action, string> = { start: 'Started', stop: 'Stopped', restart: 'Restarted' };

export function Containers({ profile }: { profile: string }) {
  const toast = useToast();
  const [groups, setGroups] = useState<ProjectGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [logsFor, setLogsFor] = useState<Container | null>(null);
  const base = `/api/profiles/${encodeURIComponent(profile)}`;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setGroups(await api<ProjectGroup[]>(`${base}/containers`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (key: string, path: string, done: string) => {
    setPending((s) => new Set(s).add(key));
    try {
      await post(path);
      toast.success(done);
    } catch (e) {
      toast.error((e as Error).message);
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
    run(c.id, `${base}/containers/${c.id}/${action}`, `${PAST[action]} ${c.name}`);

  const projectAction = (project: string, action: Action) =>
    run(
      `project:${project}`,
      `${base}/projects/${encodeURIComponent(project)}/${action}`,
      `${PAST[action]} ${project}`,
    );

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const counts = useMemo(() => {
    const all = groups?.flatMap((g) => g.containers) ?? [];
    const running = all.filter((c) => c.state === 'running').length;
    return { all: all.length, running, stopped: all.length - running };
  }, [groups]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (groups ?? [])
      .map((g) => ({
        ...g,
        containers: g.containers.filter((c) => {
          if (filter === 'running' && c.state !== 'running') return false;
          if (filter === 'stopped' && c.state === 'running') return false;
          return !q || [c.name, c.image, g.project ?? ''].some((s) => s.toLowerCase().includes(q));
        }),
      }))
      .filter((g) => g.containers.length > 0);
  }, [groups, query, filter]);

  if (groups === null) {
    return error ? <div className="notice notice-error">{error}</div> : <div className="skeleton" aria-busy />;
  }

  return (
    <div className="containers">
      <div className="toolbar">
        <label className="search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            placeholder="Filter by name, image or project"
            aria-label="Filter containers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="segmented" role="radiogroup" aria-label="Show">
          {(['all', 'running', 'stopped'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {f[0]!.toUpperCase() + f.slice(1)}
              <span className="count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <IconButton label="Refresh" onClick={() => void refresh()}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
        </IconButton>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {visible.length === 0 && (
        <div className="empty">{counts.all === 0 ? 'No containers in this VM.' : 'Nothing matches.'}</div>
      )}

      {visible.map((g) => {
        const key = g.project ?? '__standalone';
        const isCollapsed = collapsed.has(key);
        const busy = g.project !== null && pending.has(`project:${g.project}`);
        return (
          <div className="group" key={key}>
            <div className="group-head">
              <button type="button" className="group-toggle" aria-expanded={!isCollapsed} onClick={() => toggle(key)}>
                <ChevronRight size={14} className={`chevron ${isCollapsed ? '' : 'chevron-open'}`} />
                <span className="group-name">{g.project ?? 'Standalone'}</span>
                <span className="group-count">
                  {g.running}/{g.total} up
                </span>
                {g.workingDir && <span className="group-dir">{shortenPath(g.workingDir)}</span>}
              </button>
              {g.project && (
                <Menu
                  items={[
                    {
                      label: 'Start all',
                      icon: <Play size={14} />,
                      disabled: busy || g.running === g.total,
                      onSelect: () => projectAction(g.project!, 'start'),
                    },
                    {
                      label: 'Restart all',
                      icon: <RotateCw size={14} />,
                      disabled: busy,
                      onSelect: () => projectAction(g.project!, 'restart'),
                      confirm: {
                        title: `Restart all of ${g.project}?`,
                        body: <p>Restarts {plural(g.total, 'container')} at once.</p>,
                        confirmLabel: 'Restart all',
                      },
                    },
                    {
                      label: 'Stop all',
                      icon: <Square size={13} />,
                      tone: 'danger',
                      disabled: busy || g.running === 0,
                      onSelect: () => projectAction(g.project!, 'stop'),
                      confirm: {
                        title: `Stop all of ${g.project}?`,
                        body: (
                          <p>
                            Stops {plural(g.running, 'running container')}. Start them again from here or with compose.
                          </p>
                        ),
                        confirmLabel: 'Stop all',
                      },
                    },
                  ]}
                >
                  <IconButton label={`Actions for ${g.project}`}>
                    <Ellipsis size={16} />
                  </IconButton>
                </Menu>
              )}
            </div>

            {!isCollapsed && (
              <ul className="rows">
                {g.containers.map((c) => (
                  <ContainerRow
                    key={c.id}
                    container={c}
                    busy={busy || pending.has(c.id)}
                    onLogs={() => setLogsFor(c)}
                    onAction={(a) => containerAction(c, a)}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {logsFor && <LogDrawer profile={profile} container={logsFor} onClose={() => setLogsFor(null)} />}
    </div>
  );
}

function ContainerRow({
  container: c,
  busy,
  onLogs,
  onAction,
}: {
  container: Container;
  busy: boolean;
  onLogs: () => void;
  onAction: (a: Action) => Promise<void>;
}) {
  const running = c.state === 'running';
  const health = /\((healthy|unhealthy|health: starting)\)/.exec(c.status)?.[1];
  const tone = !running ? 'off' : health === 'unhealthy' ? 'bad' : health === 'health: starting' ? 'warn' : 'ok';
  const statusText = c.status.replace(/\s*\((healthy|unhealthy|health: starting)\)/, '');
  return (
    <li className={`row ${running ? '' : 'row-off'}`}>
      <span className={`led led-${tone}`} title={health ?? c.state} />
      <div className="row-name">
        <span className="row-title">{c.service ?? c.name}</span>
        <span className="row-image" title={c.image}>
          {c.image}
        </span>
      </div>
      <div className="row-status">
        {statusText}
        {health && <span className={`health health-${tone}`}>{health.replace('health: ', '')}</span>}
      </div>
      <div className="row-ports">
        {c.ports.map((p) => (
          <PortChip key={p} port={p} />
        ))}
      </div>
      <div className="row-actions">
        <IconButton label="Logs" onClick={onLogs}>
          <ScrollText size={15} />
        </IconButton>
        {running ? (
          <>
            <Confirm title={`Restart ${c.name}?`} confirmLabel="Restart" onConfirm={() => onAction('restart')}>
              <IconButton label="Restart" disabled={busy}>
                <RotateCw size={15} />
              </IconButton>
            </Confirm>
            <Confirm title={`Stop ${c.name}?`} confirmLabel="Stop" tone="danger" onConfirm={() => onAction('stop')}>
              <IconButton label="Stop" disabled={busy}>
                <Square size={14} />
              </IconButton>
            </Confirm>
          </>
        ) : (
          <IconButton label="Start" disabled={busy} onClick={() => void onAction('start')}>
            <Play size={15} />
          </IconButton>
        )}
      </div>
    </li>
  );
}

/** "55321->8000/tcp" becomes a link to the published port on this host. */
function PortChip({ port }: { port: string }) {
  const m = /^(\d+)->(\d+)\/(\w+)$/.exec(port);
  if (!m) return <span className="port port-internal">{port.replace('/tcp', '')}</span>;
  const [, published, inner, proto] = m;
  const label = published === inner ? published : `${published}→${inner}`;
  if (proto !== 'tcp') return <span className="port">{`${label}/${proto}`}</span>;
  return (
    <a className="port" href={`http://${window.location.hostname}:${published}`} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function shortenPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~');
}
