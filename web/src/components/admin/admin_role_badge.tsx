export function AdminRoleBadge({ is_admin }: { is_admin: boolean }) {
  return is_admin
    ? <span className="badge badge-sm admin-badge-admin">Admin</span>
    : <span className="admin-muted">User</span>;
}
