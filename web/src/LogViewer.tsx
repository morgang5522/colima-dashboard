import { useEffect, useRef, useState } from 'react';
import type { Container } from './api.ts';

const MAX_CHARS = 1_000_000;

export function LogViewer({
  profile,
  container,
  onClose,
}: {
  profile: string;
  container: Container;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'connecting' | 'live' | 'ended' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [tail, setTail] = useState(300);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const pre = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setText('');
    setStatus('connecting');
    setError(null);
    const url = `/api/profiles/${encodeURIComponent(profile)}/containers/${container.id}/logs?tail=${tail}`;
    const es = new EventSource(url);
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
    if (follow && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [text, follow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Docker prefixes each line with an RFC 3339 timestamp; hide it unless asked.
  const shown = showTimestamps ? text : text.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /gm, '');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal logs"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Logs for ${container.name}`}
      >
        <div className="modal-head">
          <div>
            <strong>{container.name}</strong>
            <span className={`pill pill-${status === 'live' ? 'running' : status === 'error' ? 'failed' : 'stopped'}`}>
              {status}
            </span>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="toolbar small">
          <label className="check">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
          </label>
          <label className="check">
            <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap
          </label>
          <label className="check">
            <input type="checkbox" checked={showTimestamps} onChange={(e) => setShowTimestamps(e.target.checked)} />{' '}
            Timestamps
          </label>
          <label className="check">
            Last
            <select value={tail} onChange={(e) => setTail(Number(e.target.value))}>
              {[100, 300, 1000, 5000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            lines
          </label>
          <button className="ghost small" onClick={() => setText('')}>
            Clear
          </button>
        </div>
        {error && <div className="banner error">{error}</div>}
        <pre ref={pre} className={`log-output ${wrap ? 'wrap' : ''}`}>
          {shown || (status === 'connecting' ? 'Connecting…' : 'No output.')}
        </pre>
      </div>
    </div>
  );
}
