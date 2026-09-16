import type { ReactNode } from 'react';
import { Icon } from '../icon';
import type { IconName } from '../icon';

/**
 * The mobile top bar, as presentational parts rather than one configurable component —
 * each screen's bar carries a different mix of navigation, title and actions.
 */
export function MobileBar({ children }: { children: ReactNode }) {
  return <div className="m-bar">{children}</div>;
}

type ButtonProps = {
  label: string;
  icon: IconName;
  onClick: () => void;
  accent?: boolean;
  active?: boolean;
  disabled?: boolean;
};

export function MobileBarButton({ label, icon, onClick, accent = false, active = false, disabled = false }: ButtonProps) {
  const tone = accent ? ' m-icon-accent' : active ? ' m-icon-active' : '';
  return (
    <button type="button" className={`m-icon${tone}`} onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      <Icon name={icon} size={19} />
    </button>
  );
}

type TitleProps = {
  title: string;
  subtitle?: string;
  /** Turns the title into a menu button, for pickers like the notes list's folder switch. */
  onPress?: () => void;
};

export function MobileBarTitle({ title, subtitle, onPress }: TitleProps) {
  const body = (
    <>
      <span className="m-title-main">
        {title}
        {onPress && <Icon name="chevron_down" size={15} className="m-title-caret" />}
      </span>
      {subtitle && <span className="m-title-sub">{subtitle}</span>}
    </>
  );

  if (!onPress) return <div className="m-title">{body}</div>;
  return (
    <button type="button" className="m-title m-title-button" onClick={onPress} aria-haspopup="menu">
      {body}
    </button>
  );
}
