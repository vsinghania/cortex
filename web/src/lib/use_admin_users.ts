import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from './api_client';
import type { AdminUserPage } from './admin.types';

const PAGE_SIZE = 50;

export type AdminUsersState = {
  page: AdminUserPage | null;
  loading: boolean;
  error: string | null;
  has_prev: boolean;
  has_next: boolean;
  prev: () => void;
  next: () => void;
  reload: () => Promise<void>;
};

export function useAdminUsers(): AdminUsersState {
  const [offset, set_offset] = useState(0);
  const [page, set_page] = useState<AdminUserPage | null>(null);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  const reload = useCallback(async () => {
    set_loading(true);
    set_error(null);
    try {
      set_page(await ApiClient.listAdminUsers({ limit: PAGE_SIZE, offset }));
    } catch {
      set_error("We couldn't load users.");
    } finally {
      set_loading(false);
    }
  }, [offset]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const has_prev = offset > 0;
  const has_next = page !== null && offset + page.users.length < page.total;

  const prev = useCallback(() => set_offset((o) => Math.max(0, o - PAGE_SIZE)), []);
  const next = useCallback(() => set_offset((o) => o + PAGE_SIZE), []);

  return { page, loading, error, has_prev, has_next, prev, next, reload };
}
