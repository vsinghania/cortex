import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../icon';
import type { IconName } from '../icon';
import { RadialMenu } from '../../lib/radial_menu';
import { Haptics } from '../../lib/haptics';

/** How long the button must be held before the menu fans out. */
const HOLD_MS = 340;

export type RadialFabAction = {
  key: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
};

type Props = {
  actions: RadialFabAction[];
  /** Fired by a plain tap, without opening the menu. */
  default_key: string;
  label: string;
};

type Origin = { x: number; y: number };

/**
 * Tap to compose, or hold and swipe to pick what to compose. The press is tracked through
 * pointer capture so the gesture survives the finger leaving the button.
 */
export function RadialFab({ actions, default_key, label }: Props) {
  const button_ref = useRef<HTMLButtonElement>(null);
  const timer_ref = useRef(0);
  const press_ref = useRef<{ x: number; y: number; opened: boolean; sticky: boolean } | null>(null);
  const active_ref = useRef(-1);
  const [origin, set_origin] = useState<Origin | null>(null);
  const [active, set_active] = useState(-1);

  const open = !!origin;

  const setActive = useCallback((index: number) => {
    if (index === active_ref.current) return;
    active_ref.current = index;
    set_active(index);
    if (index >= 0) Haptics.hover();
  }, []);

  const close = useCallback(() => {
    window.clearTimeout(timer_ref.current);
    press_ref.current = null;
    set_origin(null);
    active_ref.current = -1;
    set_active(-1);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // StrictMode double-invokes effects, and a hold can be interrupted by a re-render.
  useEffect(() => () => window.clearTimeout(timer_ref.current), []);

  function openMenu() {
    const rect = button_ref.current?.getBoundingClientRect();
    if (!rect) return;
    const press = press_ref.current;
    if (press) press.opened = true;
    set_origin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    Haptics.open();
  }

  function commit(index: number) {
    const action = actions[index];
    close();
    if (!action) return;
    Haptics.commit();
    action.onSelect();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // A press while the menu is already up is a dismiss, not a new hold.
    press_ref.current = { x: event.clientX, y: event.clientY, opened: open, sticky: open };
    if (!open) timer_ref.current = window.setTimeout(openMenu, HOLD_MS);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const press = press_ref.current;
    if (!press) return;
    if (press.opened && origin) {
      setActive(RadialMenu.optionAt(event.clientX - origin.x, event.clientY - origin.y, actions.length));
      return;
    }
    // Sliding off before the hold lands means the user is scrolling, not composing.
    if (!RadialMenu.isTap(event.clientX - press.x, event.clientY - press.y)) window.clearTimeout(timer_ref.current);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    window.clearTimeout(timer_ref.current);
    const press = press_ref.current;
    if (!press) return;

    if (press.opened) {
      if (active_ref.current >= 0) return commit(active_ref.current);
      // Released on the button: a second tap dismisses, the first leaves the menu up to tap.
      if (press.sticky) return close();
      press_ref.current = null;
      setActive(-1);
      return;
    }

    const is_tap = RadialMenu.isTap(event.clientX - press.x, event.clientY - press.y);
    close();
    if (is_tap) actions.find((a) => a.key === default_key)?.onSelect();
  }

  return (
    <>
      <button
        ref={button_ref}
        type="button"
        className={`m-fab m-fab-radial${open ? ' m-fab-open' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={close}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${label} · hold for more`}
      >
        <Icon name="plus" size={22} />
      </button>

      {origin && (
        <div className="m-radial" onPointerDown={close} role="menu" aria-label={label}>
          <span className="m-radial-pulse" style={{ left: origin.x, top: origin.y }} aria-hidden="true" />
          {actions.map((action, index) => {
            const offset = RadialMenu.offsetOf(index, actions.length);
            const position = { left: origin.x + offset.x, top: origin.y + offset.y };
            const on = active === index;
            return (
              <div key={action.key}>
                <button
                  type="button"
                  role="menuitem"
                  className={`m-radial-option${on ? ' m-radial-option-on' : ''}`}
                  style={{ ...position, animationDelay: `${index * 35}ms` }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => {
                    event.stopPropagation();
                    commit(index);
                  }}
                >
                  <Icon name={action.icon} size={20} />
                </button>
                <span
                  className={`m-radial-label${on ? ' m-radial-label-on' : ''}`}
                  style={{ left: position.left, top: position.top + 40, animationDelay: `${index * 35}ms` }}
                >
                  {action.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
