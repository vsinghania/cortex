import type { AdminUser } from '../../lib/admin.types';
import { AdminUserFormat } from '../../lib/admin_user_format';

export function AdminUserIdentity({ user }: { user: AdminUser }) {
  return (
    <span className="admin-identity">
      <span className="admin-identity-name">{AdminUserFormat.displayName(user)}</span>
      <span className="admin-identity-email">
        {user.email}
        {!user.email_verified && <span className="admin-unverified" title="Email not verified"> · unverified</span>}
      </span>
    </span>
  );
}
