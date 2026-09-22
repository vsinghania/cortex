import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import { useAuth } from '../lib/use_auth';
import { Icon } from './icon';
import type { IconName } from './icon';
import { AppRoutes } from '../lib/app_routes';
import { AppNav } from '../lib/app_nav';
import type { AppNavItem } from '../lib/app_nav';
import { AdminNav } from '../lib/admin_nav';
import { UserRoles } from '../lib/user_roles';
import { usePersistedFlag } from '../lib/use_persisted_flag';
import { useHotkey } from '../lib/use_hotkey';
import { UserInitials } from '../lib/user_initials';
import { BrandWordmark } from './brand_wordmark';
import { PopoverMenu } from './popover_menu';

export type RailAction = {
  label: string;
  icon: IconName;
  /** Omitted on screens that do not register the hotkey, so no badge promises one. */
  shortcut_label?: string;
  onClick: () => void;
};

type Props = {
  action: RailAction;
  /** `drawer` is the mobile slide-over: always full width, closed rather than collapsed. */
  variant?: 'rail' | 'drawer';
  onClose?: () => void;
  /** Page-specific sections; receives whether the rail is collapsed to icons. */
  children?: (collapsed: boolean) => ReactNode;
};

export function AppRail({ action, variant = 'rail', onClose, children }: Props) {
  const { user } = useAuth();
  const is_drawer = variant === 'drawer';
  const [persisted_collapsed, set_collapsed] = usePersistedFlag('cortex.railCollapsed', false);
  useHotkey({ code: 'Backslash', mod: true }, () => set_collapsed((c) => !c), !is_drawer);
  // Collapsing is a desktop affordance; the drawer reads the flag but never applies it, so
  // switching to a phone and back leaves the desktop preference intact.
  const collapsed = !is_drawer && persisted_collapsed;
  const toggle_label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <aside className={`rail${collapsed ? ' rail-collapsed' : ''}${is_drawer ? ' rail-drawer' : ''}`} aria-label="Workspace">
      <div className="rail-header">
        <BrandWordmark mark_only={collapsed} />
        <div className="rail-header-actions">
          {!collapsed && <SettingsLink />}
          <button
            type="button"
            className="icon-btn"
            onClick={is_drawer ? onClose : () => set_collapsed((c) => !c)}
            aria-label={is_drawer ? 'Close menu' : toggle_label}
            title={is_drawer ? 'Close menu' : toggle_label}
          >
            <Icon name={is_drawer ? 'close' : collapsed ? 'chevrons_right' : 'chevrons_left'} size={15} />
          </button>
        </div>
      </div>

      <div className="rail-action-wrap">
        <button
          type="button"
          className="rail-action"
          onClick={action.onClick}
          title={action.shortcut_label ? `${action.label} (${action.shortcut_label})` : action.label}
        >
          <span className="rail-action-label">
            <Icon name={action.icon} size={15} />
            {!collapsed && action.label}
          </span>
          {!collapsed && action.shortcut_label && <kbd className="kbd kbd-accent">{action.shortcut_label}</kbd>}
          {collapsed && <span className="sr-only">{action.label}</span>}
        </button>
      </div>

      <div className="rail-scroll">
        <nav className="rail-section" aria-label="Primary">
          {!collapsed && <div className="rail-heading">Navigate</div>}
          {AppNav.ITEMS.map((item) => (
            <RailNavLink key={item.to} item={item} collapsed={collapsed} />
          ))}
          {UserRoles.isAdmin(user) && <RailNavLink item={AdminNav.ENTRY} collapsed={collapsed} />}
        </nav>
        {children?.(collapsed)}
      </div>

      <AccountFooter collapsed={collapsed} />
    </aside>
  );
}

/** Exported so a page's own rail section (e.g. the admin views) renders the same row. */
export function RailNavLink({ item, collapsed }: { item: AppNavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.to}
      title={item.label}
      className={({ isActive }) => `rail-item${isActive ? ' rail-item-active' : ''}`}
    >
      <Icon name={item.icon} size={15} className="rail-item-icon" />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="rail-item-label">{item.label}</span>}
    </NavLink>
  );
}

/** The one way into settings; theme and connections both live on that page. */
function SettingsLink() {
  return (
    <NavLink
      to={AppRoutes.settings()}
      className={({ isActive }) => `icon-btn${isActive ? ' icon-btn-accent' : ''}`}
      aria-label="Settings"
      title="Settings"
    >
      <Icon name="settings" size={15} />
    </NavLink>
  );
}

function AccountFooter({ collapsed }: { collapsed: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await ApiClient.logout();
    } finally {
      navigate(AppRoutes.login(), { replace: true });
    }
  }

  return (
    <div className="rail-footer">
      <span className="avatar" title={user?.name || user?.email} aria-hidden="true">
        {UserInitials.from(user)}
      </span>
      {!collapsed && (
        <>
          <div className="rail-footer-text">
            <span className="rail-footer-name">{user?.name || user?.email}</span>
            <span className="rail-footer-email">{user?.email}</span>
          </div>
          <PopoverMenu label="Account menu" trigger={<Icon name="more" size={16} />} align="end" placement="above">
            {() => (
              <button type="button" role="menuitem" className="menu-item" onClick={() => void handleLogout()}>
                <Icon name="logout" size={14} />
                Log out
              </button>
            )}
          </PopoverMenu>
        </>
      )}
    </div>
  );
}
