import { useEffect, useRef, useState } from 'react';

/** Movement below this is jitter, not a change of intent. */
const DIRECTION_THRESHOLD_PX = 8;
/** This close to the top the chrome always comes back, whatever the direction. */
const PINNED_TOP_PX = 24;
/**
 * Collapsing gives the list more height, which shrinks its maximum scrollTop; the browser
 * then clamps the scroll position and that arrives as an upward scroll, which would expand
 * the chrome straight back. Ignoring events while the collapse animates breaks the loop.
 */
const SETTLE_MS = 300;
/** A list barely taller than its pane has nothing to gain from hiding the chrome. */
const MIN_SCROLL_ROOM_PX = 180;

export type ChromeCollapse<T extends HTMLElement> = {
  /** Put this on the element wrapping the screen; the scroller can be any descendant. */
  ref: React.RefObject<T>;
  collapsed: boolean;
};

/**
 * Hides the top chrome while the user scrolls down a list and brings it back on the first
 * scroll up, the way most phone apps behave. Scroll events don't bubble, so the inner pane's
 * scrolling is picked up on the capture phase — that keeps the list components unaware of this.
 */
export function useChromeCollapse<T extends HTMLElement>(): ChromeCollapse<T> {
  const ref = useRef<T>(null);
  const [collapsed, set_collapsed] = useState(false);
  const last_top = useRef(0);
  const settled_at = useRef(0);
  const collapsed_ref = useRef(false);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    function apply(next: boolean) {
      if (next === collapsed_ref.current) return;
      collapsed_ref.current = next;
      settled_at.current = performance.now() + SETTLE_MS;
      set_collapsed(next);
    }

    function onScroll(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const top = target.scrollTop;

      if (performance.now() < settled_at.current) {
        last_top.current = top;
        return;
      }
      // Measured against the host, whose height doesn't change when the chrome collapses —
      // using the pane's own clientHeight would make this test flip with its own result.
      const room = target.scrollHeight - (host?.clientHeight ?? target.clientHeight);
      if (top <= PINNED_TOP_PX || room < MIN_SCROLL_ROOM_PX) {
        last_top.current = top;
        apply(false);
        return;
      }
      const delta = top - last_top.current;
      if (Math.abs(delta) < DIRECTION_THRESHOLD_PX) return;
      last_top.current = top;
      apply(delta > 0);
    }

    host.addEventListener('scroll', onScroll, true);
    return () => host.removeEventListener('scroll', onScroll, true);
  }, []);

  return { ref, collapsed };
}
