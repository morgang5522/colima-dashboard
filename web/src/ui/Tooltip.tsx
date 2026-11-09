import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

/** A labelled icon button with a small tooltip on hover and keyboard focus. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    placement?: Placement;
    tone?: 'danger';
    children: ReactNode;
  }
>(function IconButton({ label, placement = 'top', tone, className, children, ...rest }, ref) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 6 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 350, close: 0 }, move: false }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: 'tooltip' }),
  ]);
  const mergedRef = useMergeRefs([refs.setReference, ref]);
  // The popover wrapper passes data-open; hide the tooltip while a popover is attached.
  const popoverOpen = (rest as Record<string, unknown>)['data-open'] !== undefined;

  return (
    <>
      <button
        ref={mergedRef}
        type="button"
        aria-label={label}
        className={`icon-btn ${tone === 'danger' ? 'icon-btn-danger' : ''} ${className ?? ''}`}
        {...getReferenceProps(rest)}
      >
        {children}
      </button>
      {open && !popoverOpen && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} className="tooltip" {...getFloatingProps()}>
            {label}
          </div>
        </FloatingPortal>
      )}
    </>
  );
});
