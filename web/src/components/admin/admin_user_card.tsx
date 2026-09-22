import type { AdminUser } from '../../lib/admin.types';
import { AdminIntegrationBadges } from './admin_integration_badges';
import { AdminLastActive } from './admin_last_active';
import { AdminNotesBreakdown } from './admin_notes_breakdown';
import { AdminRoleBadge } from './admin_role_badge';
import { AdminSignInBadges } from './admin_sign_in_badges';
import { AdminUserIdentity } from './admin_user_identity';

/** The phone layout of one table row: the same fields as label/value pairs. */
export function AdminUserCard({ user }: { user: AdminUser }) {
  return (
    <li className="admin-card">
      <AdminUserIdentity user={user} />
      <dl className="admin-card-facts">
        <div>
          <dt>Sign-in</dt>
          <dd><AdminSignInBadges sign_in={user.sign_in} /></dd>
        </div>
        <div>
          <dt>Last active</dt>
          <dd><AdminLastActive at={user.last_active_at} /></dd>
        </div>
        <div>
          <dt>Notes</dt>
          <dd><AdminNotesBreakdown notes={user.notes} /></dd>
        </div>
        <div>
          <dt>Chats</dt>
          <dd><span className="admin-count">{user.conversation_count}</span></dd>
        </div>
        <div>
          <dt>Integrations</dt>
          <dd><AdminIntegrationBadges integrations={user.integrations} /></dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd><AdminRoleBadge is_admin={user.is_admin} /></dd>
        </div>
      </dl>
    </li>
  );
}
