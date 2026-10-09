import type { AdminUserRecord } from '../user/types/user.types.js';
import type { AdminUserLookups, AdminUserNotes, AdminUserRow } from './types/admin_user.types.js';

export class AdminUserRowBuilder {
  private constructor() {}

  static buildUserRow(user: AdminUserRecord, lookups: AdminUserLookups): AdminUserRow {
    const onenote = lookups.onenote.get(user.user_id);
    return {
      user_id: user.user_id,
      // Older accounts exist with no name despite the schema; the row promises a string.
      name: user.name ?? '',
      email: user.email,
      is_admin: (user.roles ?? []).includes('admin'),
      sign_in: { google: user.has_google, password: user.has_password },
      email_verified: user.email_verified_at !== undefined && user.email_verified_at !== null,
      created_at: user.created_at,
      last_active_at: AdminUserRowBuilder.getLatestActivityDate(
        user.last_login_at,
        lookups.sessions.get(user.user_id)?.last_active_at
      ),
      notes: AdminUserRowBuilder.getUserNoteCounts(user.user_id, lookups),
      conversation_count: lookups.conversations.get(user.user_id)?.count ?? 0,
      integrations: onenote ? { onenote: { status: onenote.status, last_synced_at: onenote.last_synced_at } } : {}
    };
  }

  private static getUserNoteCounts(user_id: string, lookups: AdminUserLookups): AdminUserNotes {
    const counts = lookups.notes.get(user_id);
    return counts
      ? { total: counts.total, archived: counts.archived, by_source: counts.by_source }
      : { total: 0, archived: 0, by_source: {} };
  }

  private static getLatestActivityDate(a?: Date | null, b?: Date | null): Date | undefined {
    if (!a) return b ?? undefined;
    if (!b) return a;
    return a.getTime() >= b.getTime() ? a : b;
  }
}
