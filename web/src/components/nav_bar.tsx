import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/use_auth';
import { ApiClient } from '../lib/api_client';
import { BrandMark } from './brand_mark';
import { Icon } from './icon';
import type { IconName } from './icon';
import { BetaRoutes } from '../beta/lib/beta_routes';

const NAV_ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: '/notes', label: 'Notes', icon: 'notes' },
  { to: '/chat', label: 'Chat', icon: 'chat' },
  { to: '/voice', label: 'Voice', icon: 'mic' },
];

export function NavBar() {
  const { user, is_authenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Signed-out pages carry their own branding in AuthLayout.
  if (!is_authenticated) return null;

  async function handleLogout() {
    try {
      await ApiClient.logout();
    } finally {
      navigate('/login', { replace: true });
    }
  }

  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase();

  return (
    <header className="nav-bar">
      <Link to="/" className="nav-brand">
        <BrandMark size="sm" />
        <span className="nav-brand-text">cortex</span>
      </Link>
      <nav className="nav-links" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <Icon name={item.icon} size={15} />
            <span className="nav-link-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="nav-account">
        {/* A plain anchor on purpose: the beta UI loads its own stylesheet on a fresh page load. */}
        <a className="nav-link" href={`${BetaRoutes.fromClassicPath(location.pathname)}${location.search}`}>
          <Icon name="sparkle" size={15} />
          <span className="nav-link-label">Try the new UI</span>
        </a>
        <span className="nav-avatar" title={user?.email} aria-hidden="true">{initial}</span>
        <span className="nav-user">{user?.email}</span>
        <button
          type="button"
          onClick={handleLogout}
          className="ghost icon-button"
          title="Log out"
          aria-label="Log out"
        >
          <Icon name="logout" size={16} />
        </button>
      </div>
    </header>
  );
}
