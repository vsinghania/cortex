import { useSyncExternalStore } from 'react';
import { ThemeStore } from './theme_store';
import type { BetaTheme } from './theme.types';

export function useTheme(): BetaTheme {
  return useSyncExternalStore(ThemeStore.subscribe, ThemeStore.get, ThemeStore.get);
}
