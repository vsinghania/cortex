import type { AdminUser } from '../../lib/admin.types';

export function AdminSignInBadges({ sign_in }: Pick<AdminUser, 'sign_in'>) {
  if (!sign_in.google && !sign_in.password) return <span className="admin-muted">—</span>;
  return (
    <span className="admin-badges">
      {sign_in.google && <span className="badge badge-sm admin-badge-google">Google</span>}
      {sign_in.password && <span className="badge badge-sm">Password</span>}
    </span>
  );
}
