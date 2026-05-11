import { useSyncExternalStore } from 'react';
import { AuthStore } from './auth_store';
import type { User } from './auth.types';

export function useAuth(): { user: User | null; is_authenticated: boolean } {
  const store = AuthStore.instance();
  const user = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.getUser(),
    () => store.getUser(),
  );
  return { user, is_authenticated: user !== null };
}
