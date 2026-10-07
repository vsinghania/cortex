import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type Props = {
  /** Accessible name for the trigger button. */
  label: string;
  trigger: ReactNode;
  trigger_class?: string;
  align?: 'start' | 'end';
  placement?: 'below' | 'above';
  /** Receives `close` so an item can dismiss the menu after acting. */
  children: (close: () => void) => ReactNode;
};

export function PopoverMenu({ label, trigger, trigger_class = 'icon-btn', align = 'start', placement = 'below', children }: Props) {
  const [open, set_open] = useState(false);
  const container_ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!container_ref.current?.contains(event.target as Node)) set_open(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') set_open(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="popover-anchor" ref={container_ref}>
      <button
        type="button"
        className={trigger_class}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          set_open((v) => !v);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div className={`popover popover-${align} popover-${placement}`} role="menu">
          {children(() => set_open(false))}
        </div>
      )}
    </div>
  );
}
