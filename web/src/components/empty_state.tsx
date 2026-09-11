import type { ReactNode } from 'react';
import { Icon } from './icon';
import type { IconName } from './icon';

type Props = {
  icon: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  plain?: boolean;
};

export function EmptyState({ icon, title, children, actions, plain = false }: Props) {
  return (
    <div className={`empty-state${plain ? ' empty-state-plain' : ''}`}>
      <span className="empty-state-icon">
        <Icon name={icon} size={22} />
      </span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}
