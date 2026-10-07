import { AdminNav } from '../../lib/admin_nav';
import { RailNavLink } from '../app_rail';

export function AdminRailSection({ collapsed }: { collapsed: boolean }) {
  return (
    <nav className="rail-section" aria-label="Admin">
      {!collapsed && <div className="rail-heading">Admin</div>}
      {AdminNav.ITEMS.map((item) => (
        <RailNavLink key={item.to} item={item} collapsed={collapsed} />
      ))}
    </nav>
  );
}
