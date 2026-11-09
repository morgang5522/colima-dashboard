import { useState, type ReactElement, type ReactNode } from 'react';
import { Popover } from './Popover.tsx';
import { Spinner } from './Spinner.tsx';

export interface ConfirmContentProps {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'default';
  onConfirm: () => Promise<unknown> | unknown;
  close: () => void;
}

/** The body of a confirmation: what will happen, then Cancel / Confirm. Reused by menus. */
export function ConfirmContent({ title, body, confirmLabel, tone = 'default', onConfirm, close }: ConfirmContentProps) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      close();
    }
  };
  return (
    <div className="confirm">
      <p className="confirm-title">{title}</p>
      {body && <div className="confirm-body">{body}</div>}
      <div className="confirm-actions">
        <button type="button" className="btn btn-quiet" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
          onClick={run}
          disabled={busy}
          autoFocus
        >
          {busy && <Spinner />}
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

/** Wraps a button so clicking it asks for confirmation in a popover anchored to it. */
export function Confirm({
  children,
  ...props
}: Omit<ConfirmContentProps, 'close'> & { children: ReactElement<React.HTMLProps<HTMLElement>> }) {
  return (
    <Popover content={(close) => <ConfirmContent {...props} close={close} />} className="popover-confirm">
      {children}
    </Popover>
  );
}
