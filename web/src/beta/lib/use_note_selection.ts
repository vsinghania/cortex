import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type NoteSelection = {
  active: boolean;
  ids: string[];
  count: number;
  has: (id: string) => boolean;
  /** Turns selection mode on, optionally starting with one note. */
  start: (id?: string) => void;
  exit: () => void;
  toggle: (id: string) => void;
  /** Selects every note between the last toggled one (or `fallback_anchor`) and `id`, in list order. */
  extendTo: (id: string, ordered_ids: string[], fallback_anchor?: string | null) => void;
  setAll: (ids: string[]) => void;
};

/**
 * Multi-select state for the notes list. Esc leaves selection mode, unless a menu or dialog is
 * open - those own Esc, and closing one should not also drop the selection.
 */
export function useNoteSelection(): NoteSelection {
  const [active, set_active] = useState(false);
  const [selected, set_selected] = useState<Set<string>>(() => new Set());
  const anchor_ref = useRef<string | null>(null);

  const exit = useCallback(() => {
    set_active(false);
    set_selected(new Set());
    anchor_ref.current = null;
  }, []);

  const start = useCallback((id?: string) => {
    set_active(true);
    set_selected(id ? new Set([id]) : new Set());
    anchor_ref.current = id ?? null;
  }, []);

  const toggle = useCallback((id: string) => {
    set_active(true);
    set_selected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor_ref.current = id;
  }, []);

  const extendTo = useCallback((id: string, ordered_ids: string[], fallback_anchor?: string | null) => {
    const anchor = anchor_ref.current ?? fallback_anchor ?? null;
    const from = anchor ? ordered_ids.indexOf(anchor) : -1;
    const to = ordered_ids.indexOf(id);
    set_active(true);
    if (from === -1 || to === -1) {
      set_selected((current) => new Set(current).add(id));
      anchor_ref.current = id;
      return;
    }
    const [lo, hi] = from < to ? [from, to] : [to, from];
    set_selected((current) => {
      const next = new Set(current);
      for (const range_id of ordered_ids.slice(lo, hi + 1)) next.add(range_id);
      return next;
    });
  }, []);

  const setAll = useCallback((ids: string[]) => {
    set_active(true);
    set_selected(new Set(ids));
  }, []);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('.cx-beta .popover, dialog[open]')) return;
      exit();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, exit]);

  const ids = useMemo(() => [...selected], [selected]);
  const has = useCallback((id: string) => selected.has(id), [selected]);

  return { active, ids, count: ids.length, has, start, exit, toggle, extendTo, setAll };
}
