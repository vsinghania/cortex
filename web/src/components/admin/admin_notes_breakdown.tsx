import type { AdminUser } from '../../lib/admin.types';
import { AdminUserFormat } from '../../lib/admin_user_format';

export function AdminNotesBreakdown({ notes }: Pick<AdminUser, 'notes'>) {
  const breakdown = AdminUserFormat.notesBreakdown(notes);
  return (
    <span className="admin-notes">
      <span className="admin-count">{notes.total}</span>
      {breakdown && <span className="admin-notes-breakdown">{breakdown}</span>}
    </span>
  );
}
