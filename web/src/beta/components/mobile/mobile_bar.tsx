import type { ReactNode } from 'react';
import { Icon } from '../../../components/icon';
import type { IconName } from '../../../components/icon';

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

export function MobileBarTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="m-title">
      <span className="m-title-main">{title}</span>
      {subtitle && <span className="m-title-sub">{subtitle}</span>}
    </div>
  );
}
