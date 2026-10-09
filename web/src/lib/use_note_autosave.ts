import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient } from './api_client';
import type { Note, NotePatchBody } from './note.types';
import type { AutosaveStatus } from './note_workspace.types';

const AUTOSAVE_DEBOUNCE_MS = 1000;

export type NoteAutosave = {
  status: AutosaveStatus;
  schedule: (patch: NotePatchBody) => void;
  /** False when pending edits could not be saved; callers must preserve their local text. */
  flush: () => Promise<boolean>;
};

type Options = {
  /** Null while the note is still a local draft; edits queue until it has an id. */
  note_id: string | null;
  disabled?: boolean;
  onSaved: (note: Note) => void;
  onSaveFailed?: (error: Error) => void;
};

/**
 * Debounced PATCHes with one request in flight at a time. Edits made while a save is
 * running merge into the next one, so the server never sees saves out of order.
 */
export function useNoteAutosave({ note_id, disabled = false, onSaved, onSaveFailed }: Options): NoteAutosave {
  const [status, set_status] = useState<AutosaveStatus>('idle');
  const pending_ref = useRef<NotePatchBody>({});
  const in_flight_ref = useRef<Promise<boolean> | null>(null);
  const timer_ref = useRef<number | null>(null);
  const note_id_ref = useRef(note_id);
  note_id_ref.current = note_id;
  const on_saved_ref = useRef(onSaved);
  on_saved_ref.current = onSaved;
  const disabled_ref = useRef(disabled);
  disabled_ref.current = disabled;
  const on_save_failed_ref = useRef(onSaveFailed);
  on_save_failed_ref.current = onSaveFailed;
  const mounted_ref = useRef(true);
  const hasPending = () => Object.keys(pending_ref.current).length > 0;

  const setStatusIfMounted = useCallback((next: AutosaveStatus) => {
    if (mounted_ref.current) set_status(next);
  }, []);

  const drain = useCallback(async () => {
    while (hasPending() && note_id_ref.current && !disabled_ref.current) {
      const id = note_id_ref.current;
      const patch = pending_ref.current;
      pending_ref.current = {};
      setStatusIfMounted('saving');
      try {
        const res = await ApiClient.updateNote(id, patch);
        on_saved_ref.current(res.note);
      } catch (err) {
        // Put it back underneath anything typed since, so a retry sends the newest values.
        pending_ref.current = { ...patch, ...pending_ref.current };
        setStatusIfMounted('error');
        on_save_failed_ref.current?.(err instanceof Error ? err : new Error('Failed to save note.'));
        return false;
      }
    }
    setStatusIfMounted(hasPending() ? 'pending' : 'saved');
    return !hasPending();
  }, [setStatusIfMounted]);

  const flush = useCallback(async () => {
    if (timer_ref.current !== null) {
      window.clearTimeout(timer_ref.current);
      timer_ref.current = null;
    }
    if (!in_flight_ref.current) {
      in_flight_ref.current = runDrain();
    }
    return in_flight_ref.current;

    async function runDrain() {
      try {
        return await drain();
      } finally {
        in_flight_ref.current = null;
      }
    }
  }, [drain]);

  const schedule = useCallback(
    (patch: NotePatchBody) => {
      pending_ref.current = { ...pending_ref.current, ...patch };
      set_status('pending');
      if (!note_id_ref.current || disabled_ref.current) return;
      if (timer_ref.current !== null) window.clearTimeout(timer_ref.current);
      timer_ref.current = window.setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // A draft that just received its id may already have edits queued behind the create.
  useEffect(() => {
    if (note_id && hasPending()) void flush();
  }, [note_id, flush]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (hasPending() || in_flight_ref.current) event.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Switching notes unmounts the editor; whatever is still queued goes out anyway.
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
      if (hasPending()) void flush();
    };
  }, [flush]);

  return { status, schedule, flush };
}
