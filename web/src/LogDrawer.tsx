import { ArrowDownToLine, Clock, Search, WrapText, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Container } from './api.ts';
import { IconButton } from './ui/Tooltip.tsx';

const MAX_CHARS = 1_000_000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z /;

type Status = 'connecting' | 'live' | 'ended' | 'error';

export function LogDrawer({
  profile,
  container,
  onClose,
}: {
  profile: string;
  container: Container;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [timestamps, setTimestamps] = useState(false);
  const [tail, setTail] = useState(300);
  const [query, setQuery] = useState('');
  const output = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setText('');
    setStatus('connecting');
    setError(null);
    const es = new EventSource(
      `/api/profiles/${encodeURIComponent(profile)}/containers/${container.id}/logs?tail=${tail}`,
    );
    es.addEventListener('open', () => setStatus('live'));
    es.addEventListener('log', (e) => {
      const chunk = JSON.parse((e as MessageEvent<string>).data) as string;
      setText((t) => {
        const next = t + chunk;
        return next.length > MAX_CHARS ? next.slice(next.length - MAX_CHARS) : next;
      });
    });
    es.addEventListener('end', () => {
      setStatus('ended');
      es.close();
    });
    es.addEventListener('error', (e) => {
      const data = (e as MessageEvent<string>).data;
      if (data) setError(JSON.parse(data) as string);
      setStatus('error');
      es.close();
    });
    return () => es.close();
  }, [profile, container.id, tail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lines = useMemo(() => {
    let all = text.split('\n');
    if (all.at(-1) === '') all = all.slice(0, -1);
    if (!timestamps) all = all.map((l) => l.replace(TIMESTAMP, ''));
    const q = query.trim().toLowerCase();
    return q ? all.filter((l) => l.toLowerCase().includes(q)) : all;
  }, [text, timestamps, query]);

  useEffect(() => {
    if (follow && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [lines, follow]);

  // Scrolling up pauses following; scrolling back to the bottom resumes it.
  const onScroll = () => {
    const el = output.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const statusLabel = { connecting: 'connecting', live: 'live', ended: 'stream ended', error: 'disconnected' }[status];

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-label={`Logs for ${container.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div className="drawer-title">
            <span className="drawer-name">{container.name}</span>
            <span className={`stream stream-${status}`}>{statusLabel}</span>
          </div>
          <IconButton label="Close" placement="bottom-end" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="drawer-tools">
          <label className="search search-compact">
            <Search size={13} aria-hidden />
            <input
              type="search"
              placeholder="Filter lines"
              aria-label="Filter log lines"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select aria-label="Lines to load" value={tail} onChange={(e) => setTail(Number(e.target.value))}>
            {[100, 300, 1000, 5000].map((n) => (
              <option key={n} value={n}>
                Last {n}
              </option>
            ))}
          </select>
          <div className="toggles">
            <IconButton
              label={follow ? 'Following' : 'Follow'}
              aria-pressed={follow}
              onClick={() => setFollow(!follow)}
            >
              <ArrowDownToLine size={15} />
            </IconButton>
            <IconButton label="Wrap lines" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
              <WrapText size={15} />
            </IconButton>
            <IconButton label="Timestamps" aria-pressed={timestamps} onClick={() => setTimestamps(!timestamps)}>
              <Clock size={15} />
            </IconButton>
          </div>
        </div>

        {error && <div className="notice notice-error drawer-notice">{error}</div>}
        <pre ref={output} className={`log ${wrap ? 'log-wrap' : ''}`} onScroll={onScroll}>
          {lines.length ? lines.join('\n') : status === 'connecting' ? '' : query ? 'No lines match.' : 'No output.'}
        </pre>
      </aside>
    </div>
  );
}
