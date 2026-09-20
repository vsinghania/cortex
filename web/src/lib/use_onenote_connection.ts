import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from './api_client';
import { OneNoteRedirect } from './onenote_redirect';
import type { OneNoteStatus } from './onenote.types';

export type OneNoteConnectionState = {
  status: OneNoteStatus | null;
  loading: boolean;
  /** Set by a failed call or by the callback's fragment; cleared on the next action. */
  error: string | null;
  busy: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Re-reads the connection after something else changed it: a sync, or the picker. */
  reload: () => Promise<void>;
};

export function useOneNoteConnection(): OneNoteConnectionState {
  const [status, set_status] = useState<OneNoteStatus | null>(null);
  const [loading, set_loading] = useState(true);
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      set_status(await ApiClient.getOneNoteStatus());
    } catch {
      set_error("We couldn't load your OneNote connection.");
    } finally {
      set_loading(false);
    }
  }, []);

  // Read in an effect, not a useState initializer: StrictMode double-invokes the
  // initializer and the discarded first call would consume the fragment.
  useEffect(() => {
    const outcome = OneNoteRedirect.take();
    if (outcome.error) set_error(outcome.error);
    void reload();
  }, [reload]);

  const connect = useCallback(async () => {
    set_busy(true);
    set_error(null);
    try {
      const { url } = await ApiClient.startOneNoteConnect();
      // A top-level navigation, which is what the consent screen needs.
      window.location.href = url;
    } catch {
      set_error("We couldn't start the Microsoft sign-in. Try again.");
      set_busy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    set_busy(true);
    set_error(null);
    try {
      await ApiClient.disconnectOneNote();
      await reload();
    } catch {
      set_error("We couldn't disconnect OneNote. Try again.");
    } finally {
      set_busy(false);
    }
  }, [reload]);

  return { status, loading, busy, error, connect, disconnect, reload };
}
