import { useState, type ReactElement, type ReactNode } from 'react';
import { ConfirmContent } from './Confirm.tsx';
import { Popover } from './Popover.tsx';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: 'danger';
  onSelect: () => Promise<unknown> | unknown;
  /** Ask before running: the menu turns into a confirmation in place. */
  confirm?: { title: string; body?: ReactNode; confirmLabel: string };
}

/** A small action menu; items that need confirming swap the menu for a confirmation. */
export function Menu({ items, children }: { items: MenuItem[]; children: ReactElement<React.HTMLProps<HTMLElement>> }) {
  const [confirming, setConfirming] = useState<MenuItem | null>(null);
  return (
    <Popover
      role="menu"
      onOpenChange={(open) => !open && setConfirming(null)}
      content={(close) =>
        confirming?.confirm ? (
          <ConfirmContent
            {...confirming.confirm}
            tone={confirming.tone === 'danger' ? 'danger' : 'default'}
            onConfirm={confirming.onSelect}
            close={close}
          />
        ) : (
          <div className="menu">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`menu-item ${item.tone === 'danger' ? 'menu-item-danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  if (item.confirm) setConfirming(item);
                  else {
                    close();
                    void item.onSelect();
                  }
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        )
      }
    >
      {children}
    </Popover>
  );
}
