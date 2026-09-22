import type { AdminUser } from '../../lib/admin.types';
import { AdminUserFormat } from '../../lib/admin_user_format';
import { DateFormat } from '../../lib/date_format';

export function AdminIntegrationBadges({ integrations }: Pick<AdminUser, 'integrations'>) {
  const onenote = integrations.onenote;
  if (!onenote) return <span className="admin-muted">—</span>;

  const healthy = AdminUserFormat.isOneNoteHealthy(onenote.status);
  const title = onenote.last_synced_at
    ? `OneNote: ${AdminUserFormat.oneNoteStatus(onenote.status)}, last synced ${DateFormat.full(onenote.last_synced_at)}`
    : `OneNote: ${AdminUserFormat.oneNoteStatus(onenote.status)}, never synced`;

  return (
    <span className="admin-badges">
      <span className={`badge badge-sm${healthy ? '' : ' admin-badge-warn'}`} title={title}>
        OneNote{healthy ? '' : ` · ${AdminUserFormat.oneNoteStatus(onenote.status)}`}
      </span>
    </span>
  );
}
