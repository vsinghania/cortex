import { Icon } from '../icon';
import { ThemeStore } from '../../lib/theme_store';
import { useTheme } from '../../lib/use_theme';

export function ThemeSelector() {
  const theme = useTheme();

  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {(['dark', 'light'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          className={`segmented-item${theme === value ? ' segmented-item-active' : ''}`}
          onClick={() => ThemeStore.set(value)}
        >
          <Icon name={value === 'dark' ? 'moon' : 'sun'} size={13} />
          {value === 'dark' ? 'Dark' : 'Light'}
        </button>
      ))}
    </div>
  );
}
