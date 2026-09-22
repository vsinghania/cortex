import type { NoteSource } from '../../notes_svc/types/note.types.js';
import type { OneNoteConnectionStatus } from '../../onenote_svc/types/onenote_connection.types.js';
import type { NoteUserCounts } from '../../notes_svc/repositories/note_repository_interface.js';
import type { ConversationUserCount } from '../../agent_svc/conversation/conversation_repository_interface.js';
import type { OneNoteConnectionSummary } from '../../onenote_svc/types/onenote_connection.types.js';
import type { UserSessionActivity } from '../../auth_svc/repositories/refresh_token_repository_interface.js';

export type AdminUserNotes = {
  total: number;
  archived: number;
  by_source: Partial<Record<NoteSource, number>>;
};

export type AdminUserIntegrations = {
  onenote?: {
    status: OneNoteConnectionStatus;
    last_synced_at?: Date;
  };
};

export type AdminUserRow = {
  user_id: string;
  name: string;
  email: string;
  is_admin: boolean;
  sign_in: { google: boolean; password: boolean };
  email_verified: boolean;
  created_at: Date;
  /** The later of the last sign-in and the last session refresh. */
  last_active_at?: Date;
  notes: AdminUserNotes;
  conversation_count: number;
  integrations: AdminUserIntegrations;
};

export type AdminUserPage = {
  users: AdminUserRow[];
  total: number;
  limit: number;
  offset: number;
};

export type ListAdminUsersParams = {
  limit: number;
  offset: number;
};

/** Everything read about one page of users, each keyed by user_id. */
export type AdminUserLookups = {
  notes: Map<string, NoteUserCounts>;
  conversations: Map<string, ConversationUserCount>;
  onenote: Map<string, OneNoteConnectionSummary>;
  sessions: Map<string, UserSessionActivity>;
};
