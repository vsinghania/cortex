import type { AdminUser } from '../../lib/admin.types';
import { AdminIntegrationBadges } from './admin_integration_badges';
import { AdminLastActive } from './admin_last_active';
import { AdminNotesBreakdown } from './admin_notes_breakdown';
import { AdminRoleBadge } from './admin_role_badge';
import { AdminSignInBadges } from './admin_sign_in_badges';
import { AdminUserIdentity } from './admin_user_identity';

export function AdminUsersTable({ users }: { users: AdminUser[] }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">User</th>
            <th scope="col">Sign-in</th>
            <th scope="col">Last active</th>
            <th scope="col" className="admin-num">Notes</th>
            <th scope="col" className="admin-num">Chats</th>
            <th scope="col">Integrations</th>
            <th scope="col">Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.user_id}>
              <td><AdminUserIdentity user={user} /></td>
              <td><AdminSignInBadges sign_in={user.sign_in} /></td>
              <td><AdminLastActive at={user.last_active_at} /></td>
              <td className="admin-num"><AdminNotesBreakdown notes={user.notes} /></td>
              <td className="admin-num"><span className="admin-count">{user.conversation_count}</span></td>
              <td><AdminIntegrationBadges integrations={user.integrations} /></td>
              <td><AdminRoleBadge is_admin={user.is_admin} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
