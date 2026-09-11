import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** Grows a textarea with its content up to `max_height_px`, after which it scrolls. */
export function useAutosize(
  ref: RefObject<HTMLTextAreaElement>,
  value: string,
  max_height_px: number,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, max_height_px)}px`;
  }, [ref, value, max_height_px]);
}
