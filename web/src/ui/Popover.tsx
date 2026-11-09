import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { cloneElement, useState, type HTMLProps, type ReactElement, type ReactNode, type Ref } from 'react';

export interface PopoverProps {
  /** The element that opens the popover. It receives the ref and click handlers. */
  children: ReactElement<HTMLProps<HTMLElement> & { ref?: Ref<HTMLElement> }>;
  /** Popover body; `close` dismisses it. */
  content: (close: () => void) => ReactNode;
  placement?: Placement;
  role?: 'dialog' | 'menu';
  className?: string;
  /** Called whenever the popover opens or closes. */
  onOpenChange?: (open: boolean) => void;
}

/** A click-triggered popover anchored to its trigger, with focus management and Esc / outside-click to close. */
export function Popover({
  children,
  content,
  placement = 'bottom-end',
  role = 'dialog',
  className,
  onOpenChange,
}: PopoverProps) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.max(220, availableWidth)}px`;
        },
      }),
    ],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role }),
  ]);

  const trigger = cloneElement(children, {
    ref: refs.setReference,
    ...getReferenceProps({
      ...children.props,
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();
        children.props.onClick?.(e);
      },
    }),
    'data-open': open ? '' : undefined,
  } as HTMLProps<HTMLElement>);

  return (
    <>
      {trigger}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={`popover ${className ?? ''}`}
              {...getFloatingProps({ onClick: (e) => e.stopPropagation() })}
            >
              {content(() => setOpen(false))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
