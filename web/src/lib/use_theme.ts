import { useSyncExternalStore } from 'react';
import { ThemeStore } from './theme_store';
import type { Theme } from './theme.types';

export function useTheme(): Theme {
  return useSyncExternalStore(ThemeStore.subscribe, ThemeStore.get, ThemeStore.get);
}
