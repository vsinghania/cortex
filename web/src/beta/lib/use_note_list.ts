import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../../lib/api_client';
import type { Note } from '../../lib/note.types';
import type { NoteFilters } from './note_workspace.types';
import { NoteFilterParams } from './note_filter_params';

const PAGE_SIZE = 50;
const PINNED_LIMIT = 50;
/** The API caps `limit`; a refresh reloads at most this many rows in one request. */
const MAX_PAGE_SIZE = 100;

export type NoteList = {
  pinned: Note[];
  items: Note[];
  total: number;
  /** Everything matching the filters, pinned rows included. */
  count: number;
  has_more: boolean;
  loading: boolean;
  loading_more: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  find: (id: string) => Note | undefined;
  updateLocal: (note: Note) => void;
  removeLocal: (id: string) => void;
  prependLocal: (note: Note) => void;
};

/**
 * Pinned notes are a separate query rather than a client-side sort, so a pinned note
 * past the first page still shows at the top.
 */
export function useNoteList(filters: NoteFilters): NoteList {
  const query = useMemo(
    () => NoteFilterParams.toListQuery(filters),
    // The filters object is rebuilt from the URL on every render; its fields are the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.folder, filters.archived, filters.tag, filters.q, filters.sort],
  );
  const [pinned, set_pinned] = useState<Note[]>([]);
  const [items, set_items] = useState<Note[]>([]);
  const [total, set_total] = useState(0);
  const [loading, set_loading] = useState(true);
  const [loading_more, set_loading_more] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  // Every response checks this so a slow reply for an old filter never lands on a new one.
  const request_seq = useRef(0);
  const pinned_ref = useRef(pinned);
  const items_ref = useRef(items);
  pinned_ref.current = pinned;
  items_ref.current = items;

  const load = useCallback(
    async (limit: number) => {
      const seq = ++request_seq.current;
      set_loading(true);
      try {
        const [pinned_res, items_res] = await Promise.all([
          ApiClient.listNotes({ ...query, pinned: true, limit: PINNED_LIMIT }),
          ApiClient.listNotes({ ...query, pinned: false, limit, offset: 0 }),
        ]);
        if (seq !== request_seq.current) return;
        set_pinned(pinned_res.items);
        set_items(items_res.items);
        set_total(items_res.total);
        set_error(null);
      } catch (err) {
        if (seq === request_seq.current) set_error(err instanceof Error ? err.message : 'Failed to load notes.');
      } finally {
        if (seq === request_seq.current) set_loading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void load(PAGE_SIZE);
  }, [load]);

  const refresh = useCallback(
    () => load(Math.min(MAX_PAGE_SIZE, Math.max(PAGE_SIZE, items_ref.current.length))),
    [load],
  );

  const loadMore = useCallback(async () => {
    if (loading_more || items_ref.current.length >= total) return;
    const seq = request_seq.current;
    set_loading_more(true);
    try {
      const res = await ApiClient.listNotes({ ...query, pinned: false, limit: PAGE_SIZE, offset: items_ref.current.length });
      if (seq !== request_seq.current) return;
      // Edits reorder the server's list between pages, so a row can come back twice.
      set_items((current) => {
        const seen = new Set(current.map((n) => n.id));
        return [...current, ...res.items.filter((n) => !seen.has(n.id))];
      });
      set_total(res.total);
    } catch (err) {
      if (seq === request_seq.current) set_error(err instanceof Error ? err.message : 'Failed to load more notes.');
    } finally {
      set_loading_more(false);
    }
  }, [loading_more, query, total]);

  const find = useCallback(
    (id: string) => pinned_ref.current.find((n) => n.id === id) ?? items_ref.current.find((n) => n.id === id),
    [],
  );

  const updateLocal = useCallback((note: Note) => {
    const replace = (list: Note[]) => list.map((n) => (n.id === note.id ? note : n));
    set_pinned(replace);
    set_items(replace);
  }, []);

  const removeLocal = useCallback((id: string) => {
    set_pinned((list) => list.filter((n) => n.id !== id));
    if (items_ref.current.some((n) => n.id === id)) {
      set_items((list) => list.filter((n) => n.id !== id));
      set_total((t) => Math.max(0, t - 1));
    }
  }, []);

  const prependLocal = useCallback((note: Note) => {
    set_items((list) => [note, ...list.filter((n) => n.id !== note.id)]);
    set_total((t) => t + 1);
  }, []);

  return {
    pinned,
    items,
    total,
    count: pinned.length + total,
    has_more: items.length < total,
    loading,
    loading_more,
    error,
    refresh,
    loadMore,
    find,
    updateLocal,
    removeLocal,
    prependLocal,
  };
}
