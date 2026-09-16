import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../icon';
import { AppNav } from '../../lib/app_nav';
import type { AppNavItem } from '../../lib/app_nav';

/** `children` fills the centre slot between the two destinations — the compose button. */
export function MobileTabBar({ children }: { children?: ReactNode }) {
  const [primary, secondary] = AppNav.ITEMS;

  return (
    <nav className="m-tabs" aria-label="Primary">
      <TabLink item={primary} />
      <div className="m-tabs-centre">{children}</div>
      <TabLink item={secondary} />
    </nav>
  );
}

function TabLink({ item }: { item: AppNavItem }) {
  return (
    <NavLink to={item.to} className={({ isActive }) => `m-tab${isActive ? ' m-tab-active' : ''}`}>
      <Icon name={item.icon} size={19} />
      <span className="m-tab-label">{item.label}</span>
    </NavLink>
  );
}
