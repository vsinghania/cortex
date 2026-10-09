import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient, ApiError } from './api_client';
import type { Note } from './note.types';

/** Just past the server's deferred-indexing delay, so one recheck usually sees it finish. */
const INDEXING_RECHECK_MS = 35_000;
const MAX_INDEXING_RECHECKS = 4;

export type CurrentNote = {
  note: Note | null;
  loading: boolean;
  error: string | null;
  missing: boolean;
  set: (note: Note) => void;
  refreshNote: () => Promise<Note | null>;
};

/**
 * Loads the selected note, seeding from the list so switching is instant, and polls a
 * pending deferred embed until it settles so the editor can stop saying "indexing".
 */
export function useCurrentNote(note_id: string | null, seed: (id: string) => Note | undefined): CurrentNote {
  const [note, set_note] = useState<Note | null>(null);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [missing, set_missing] = useState(false);
  const [recheck_count, set_recheck_count] = useState(0);
  const note_ref = useRef(note);
  note_ref.current = note;
  const seed_ref = useRef(seed);
  seed_ref.current = seed;
  const selected_id_ref = useRef(note_id);
  selected_id_ref.current = note_id;
  const request_seq = useRef(0);

  useEffect(() => {
    const seq = ++request_seq.current;
    set_loading(false);
    set_error(null);
    set_missing(false);
    set_recheck_count(0);
    if (!note_id) {
      set_note(null);
      return;
    }
    // Already in hand, e.g. set by the page right after creating it.
    if (note_ref.current?.id === note_id) return;

    set_note(seed_ref.current(note_id) ?? null);
    let cancelled = false;
    async function load(id: string) {
      set_loading(true);
      try {
        const res = await ApiClient.getNote(id);
        if (!cancelled && seq === request_seq.current) set_note(res.note);
      } catch (err) {
        if (!cancelled && seq === request_seq.current) {
          if (note_ref.current?.id !== id) set_note(null);
          set_missing(err instanceof ApiError && err.status === 404);
          set_error(err instanceof Error ? err.message : 'Failed to load note.');
        }
      } finally {
        if (!cancelled && seq === request_seq.current) set_loading(false);
      }
    }
    void load(note_id);
    return () => {
      cancelled = true;
    };
  }, [note_id]);

  const refreshNote = useCallback(async () => {
    if (!note_id) return null;
    const seq = ++request_seq.current;
    set_loading(true);
    try {
      const res = await ApiClient.getNote(note_id, true);
      if (selected_id_ref.current !== note_id || seq !== request_seq.current) return null;
      set_note(res.note);
      set_error(null);
      set_missing(false);
      set_recheck_count(0);
      return res.note;
    } finally {
      if (selected_id_ref.current === note_id && seq === request_seq.current) set_loading(false);
    }
  }, [note_id]);

  const is_pending = note?.vectorization?.status === 'pending';
  const current_id = note?.id;

  useEffect(() => {
    if (!is_pending || !current_id || recheck_count >= MAX_INDEXING_RECHECKS) return;
    const timer = window.setTimeout(async () => {
      try {
        const res = await ApiClient.getNote(current_id);
        // Only the indexing state is taken: the editor owns title and body while open.
        set_note((cur) => (cur?.id === res.note.id ? { ...cur, vectorization: res.note.vectorization } : cur));
      } catch {
        // A failed recheck just leaves "indexing" up; the next save rechecks again.
      } finally {
        set_recheck_count((n) => n + 1);
      }
    }, INDEXING_RECHECK_MS);
    return () => window.clearTimeout(timer);
  }, [is_pending, current_id, recheck_count]);

  const set = useCallback((next: Note) => {
    if (selected_id_ref.current && selected_id_ref.current !== next.id) return;
    set_note(next);
    set_missing(false);
    set_recheck_count(0);
  }, []);

  return { note, loading, error, missing, set, refreshNote };
}
