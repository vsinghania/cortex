import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const HOLD_MS = 420;
/** Past this the press is a scroll, not a hold. */
const DRIFT_PX = 10;

export type LongPressHandlers = {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
};

/**
 * Touch's stand-in for the desktop ⌘-click that opens selection mode. The click that follows
 * still fires, so callers guard against acting on it twice — `fired` reports the hold.
 */
export function useLongPress(onLongPress: () => void, enabled = true): LongPressHandlers {
  const timer_ref = useRef(0);
  const origin_ref = useRef<{ x: number; y: number } | null>(null);
  const handler_ref = useRef(onLongPress);
  handler_ref.current = onLongPress;

  const cancel = useCallback(() => {
    window.clearTimeout(timer_ref.current);
    origin_ref.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (event) => {
      if (!enabled || event.pointerType === 'mouse') return;
      origin_ref.current = { x: event.clientX, y: event.clientY };
      timer_ref.current = window.setTimeout(() => {
        origin_ref.current = null;
        handler_ref.current();
      }, HOLD_MS);
    },
    onPointerMove: (event) => {
      const origin = origin_ref.current;
      if (!origin) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > DRIFT_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}
