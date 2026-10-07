import type { AdminUser, AdminUserNotes, NoteSourceKey } from './admin.types';
import type { OneNoteConnectionStatus } from './onenote.types';

/** Presentation for admin user rows, shared by the desktop table and the mobile cards. */
export class AdminUserFormat {
  private static readonly SOURCE_LABELS: Record<NoteSourceKey, string> = {
    native: 'native',
    onenote: 'OneNote',
    notion: 'Notion',
    evernote: 'Evernote',
    other: 'other',
  };

  private static readonly ONENOTE_STATUS_LABELS: Record<OneNoteConnectionStatus, string> = {
    connected: 'Connected',
    needs_reauth: 'Needs reauth',
    error: 'Error',
  };

  /** e.g. "30 OneNote · 12 native · 3 archived"; largest source first, empty sources omitted. */
  static notesBreakdown(notes: AdminUserNotes): string {
    const parts = (Object.entries(notes.by_source) as Array<[NoteSourceKey, number]>)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([source, count]) => `${count} ${AdminUserFormat.SOURCE_LABELS[source] ?? source}`);
    if (notes.archived > 0) parts.push(`${notes.archived} archived`);
    return parts.join(' · ');
  }

  static oneNoteStatus(status: OneNoteConnectionStatus): string {
    return AdminUserFormat.ONENOTE_STATUS_LABELS[status] ?? status;
  }

  static isOneNoteHealthy(status: OneNoteConnectionStatus): boolean {
    return status === 'connected';
  }

  static displayName(user: Pick<AdminUser, 'name' | 'email'>): string {
    return user.name?.trim() || user.email;
  }
}
