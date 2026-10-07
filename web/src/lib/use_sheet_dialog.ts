import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Closing is deferred until the exit transition ends, but reduced-motion users have every
 * transition disabled, so `transitionend` never fires for them. The timer is the floor.
 */
const CLOSE_FALLBACK_MS = 320;

export type SheetDialog = {
  ref: RefObject<HTMLDialogElement>;
  /** True once the browser has painted the closed state, so the enter transition can run. */
  shown: boolean;
};

/**
 * Drives a native modal <dialog> that animates in and out. `showModal()` gives us the focus
 * trap, Esc, an `inert` background and the browser's top layer for free; the class flip one
 * frame later is what lets CSS transition the panel from its off-screen position.
 */
export function useSheetDialog(open: boolean): SheetDialog {
  const ref = useRef<HTMLDialogElement>(null);
  const [shown, set_shown] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      // Two frames: the first lets the browser paint the closed state that `showModal` just
      // revealed, the second flips the class so there is something to transition from.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => set_shown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }

    set_shown(false);
    if (!dialog.open) return;

    // The <dialog> itself must carry a transition (its scrim opacity) for this to fire —
    // the inner panel's transform bubbles up here too and is ignored.
    function finish(event: TransitionEvent) {
      if (event.target !== event.currentTarget) return;
      close();
    }
    function close() {
      window.clearTimeout(timer);
      dialog?.removeEventListener('transitionend', finish);
      if (dialog?.open) dialog.close();
    }

    const timer = window.setTimeout(close, CLOSE_FALLBACK_MS);
    dialog.addEventListener('transitionend', finish);
    return close;
  }, [open]);

  return { ref, shown };
}
