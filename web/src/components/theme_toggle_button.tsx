import { Icon } from './icon';
import { ThemeStore } from '../lib/theme_store';
import { useTheme } from '../lib/use_theme';

/**
 * A one-tap toggle for surfaces that have no rail to reach the settings popover from —
 * the mobile top bar and the auth pages.
 */
export function ThemeToggleButton({ className = 'm-icon' }: { className?: string }) {
  const theme = useTheme();
  const label = theme === 'dark' ? 'Light mode' : 'Dark mode';

  return (
    <button type="button" className={className} onClick={() => ThemeStore.toggle()} aria-label={label} title={label}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}
