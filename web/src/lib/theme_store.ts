import type { Theme } from './theme.types';

type Listener = () => void;

/**
 * The UI is dark by design and deliberately ignores prefers-color-scheme; light is
 * an explicit opt-in that sticks per browser.
 */
export class ThemeStore {
  private static readonly STORAGE_KEY = 'cortex.theme';
  private static readonly DEFAULT_THEME: Theme = 'dark';
  private static current: Theme = ThemeStore.readStored();
  private static readonly listeners: Set<Listener> = new Set();

  static get(): Theme {
    return ThemeStore.current;
  }

  static set(theme: Theme): void {
    if (theme === ThemeStore.current) return;
    ThemeStore.current = theme;
    try {
      localStorage.setItem(ThemeStore.STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts for this visit.
    }
    ThemeStore.listeners.forEach((fn) => fn());
  }

  static toggle(): void {
    ThemeStore.set(ThemeStore.current === 'dark' ? 'light' : 'dark');
  }

  static subscribe(fn: Listener): () => void {
    ThemeStore.listeners.add(fn);
    return () => {
      ThemeStore.listeners.delete(fn);
    };
  }

  private static readStored(): Theme {
    try {
      const stored = localStorage.getItem(ThemeStore.STORAGE_KEY);
      return stored === 'light' || stored === 'dark' ? stored : ThemeStore.DEFAULT_THEME;
    } catch {
      return ThemeStore.DEFAULT_THEME;
    }
  }
}
