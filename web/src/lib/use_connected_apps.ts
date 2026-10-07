import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from './api_client';
import type { ConnectedAppsStatus } from './connected_apps.types';

export type ConnectedAppsState = {
  status: ConnectedAppsStatus | null;
  loading: boolean;
  error: string | null;
  /** The grant being disconnected, so only its row shows as busy. */
  disconnecting: string | null;
  disconnect: (grant_id: string) => Promise<void>;
};

export function useConnectedApps(): ConnectedAppsState {
  const [status, set_status] = useState<ConnectedAppsStatus | null>(null);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [disconnecting, set_disconnecting] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      set_status(await ApiClient.getConnectedApps());
    } catch {
      set_error("We couldn't load your connected assistants.");
    } finally {
      set_loading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const disconnect = useCallback(
    async (grant_id: string) => {
      set_disconnecting(grant_id);
      set_error(null);
      try {
        await ApiClient.disconnectApp(grant_id);
        await reload();
      } catch {
        set_error("We couldn't disconnect that assistant. Try again.");
      } finally {
        set_disconnecting(null);
      }
    },
    [reload]
  );

  return { status, loading, error, disconnecting, disconnect };
}
