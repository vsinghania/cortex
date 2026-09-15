import type { ReactNode } from 'react';
import { Icon } from '../../components/icon';
import type { IconName } from '../../components/icon';

type Props = {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
};

export function EmptyPanel({ icon = 'hexagon', title, children, actions }: Props) {
  return (
    <div className="empty-panel">
      <Icon name={icon} size={34} className="empty-panel-icon" />
      <p className="empty-panel-title">{title}</p>
      {children && <p className="empty-panel-body">{children}</p>}
      {actions && <div className="empty-panel-actions">{actions}</div>}
    </div>
  );
}
