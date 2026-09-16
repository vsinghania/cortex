import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ApiClient } from '../../lib/api_client';
import { useAuth } from '../../lib/use_auth';
import { Icon } from '../../components/icon';
import type { IconName } from '../../components/icon';
import { BetaRoutes } from '../lib/beta_routes';
import { BetaNav } from '../lib/beta_nav';
import { ThemeStore } from '../lib/theme_store';
import { useTheme } from '../lib/use_theme';
import { usePersistedFlag } from '../lib/use_persisted_flag';
import { useHotkey } from '../lib/use_hotkey';
import { UserInitials } from '../lib/user_initials';
import { BrandWordmark } from './brand_wordmark';
import { PopoverMenu } from './popover_menu';

export type RailAction = {
  label: string;
  icon: IconName;
  shortcut_label: string;
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
          {!collapsed && <SettingsMenu />}
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
        <button type="button" className="rail-action" onClick={action.onClick} title={`${action.label} (${action.shortcut_label})`}>
          <span className="rail-action-label">
            <Icon name={action.icon} size={15} />
            {!collapsed && action.label}
          </span>
          {!collapsed && <kbd className="kbd kbd-accent">{action.shortcut_label}</kbd>}
          {collapsed && <span className="sr-only">{action.label}</span>}
        </button>
      </div>

      <div className="rail-scroll">
        <nav className="rail-section" aria-label="Primary">
          {!collapsed && <div className="rail-heading">Navigate</div>}
          {BetaNav.ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) => `rail-item${isActive ? ' rail-item-active' : ''}`}
            >
              <Icon name={item.icon} size={15} className="rail-item-icon" />
              {collapsed ? <span className="sr-only">{item.label}</span> : <span className="rail-item-label">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
        {children?.(collapsed)}
      </div>

      <AccountFooter collapsed={collapsed} />
    </aside>
  );
}

function SettingsMenu() {
  const theme = useTheme();
  const location = useLocation();

  return (
    <PopoverMenu label="Settings" trigger={<Icon name="settings" size={15} />} align="start">
      {(close) => (
        <>
          <div className="menu-heading">Appearance</div>
          <div className="segmented segmented-full" role="radiogroup" aria-label="Theme">
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
          <div className="menu-divider" />
          {/* A plain anchor on purpose: the classic UI needs a fresh page load for its own stylesheet. */}
          <a
            className="menu-item"
            role="menuitem"
            href={`${BetaRoutes.toClassicPath(location.pathname)}${location.search}`}
            onClick={close}
          >
            <Icon name="switch_ui" size={14} />
            Switch to classic UI
          </a>
        </>
      )}
    </PopoverMenu>
  );
}

function AccountFooter({ collapsed }: { collapsed: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await ApiClient.logout();
    } finally {
      navigate(BetaRoutes.login(), { replace: true });
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
