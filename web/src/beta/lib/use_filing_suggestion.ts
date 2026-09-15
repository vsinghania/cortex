import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient } from '../../lib/api_client';
import type { NoteFilingSuggestion, NoteFilingSuggestionBody } from '../../lib/note.types';

export type FilingSuggestionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; suggestion: NoteFilingSuggestion }
  | { status: 'error'; message: string };

export type FilingSuggestion = {
  state: FilingSuggestionState;
  request: (body: NoteFilingSuggestionBody) => void;
  dismiss: () => void;
};

/** One suggestion at a time: a newer request or a dismiss discards whatever answer is still on its way. */
export function useFilingSuggestion(): FilingSuggestion {
  const [state, set_state] = useState<FilingSuggestionState>({ status: 'idle' });
  const request_seq_ref = useRef(0);

  useEffect(() => {
    return () => {
      request_seq_ref.current += 1;
    };
  }, []);

  const request = useCallback((body: NoteFilingSuggestionBody) => {
    const seq = ++request_seq_ref.current;
    set_state({ status: 'loading' });

    async function load() {
      try {
        const res = await ApiClient.suggestNoteFiling(body);
        if (seq === request_seq_ref.current) set_state({ status: 'ready', suggestion: res.suggestion });
      } catch (err) {
        if (seq !== request_seq_ref.current) return;
        set_state({ status: 'error', message: err instanceof Error ? err.message : "Couldn't get suggestions." });
      }
    }
    void load();
  }, []);

  const dismiss = useCallback(() => {
    request_seq_ref.current += 1;
    set_state({ status: 'idle' });
  }, []);

  return { state, request, dismiss };
}
