import type { OneNoteConnectionStatus } from './onenote.types';

/** Mirrors the server's NoteSource; an admin row counts notes per source. */
export type NoteSourceKey = 'native' | 'notion' | 'onenote' | 'evernote' | 'other';

export type AdminUserNotes = {
  total: number;
  archived: number;
  by_source: Partial<Record<NoteSourceKey, number>>;
};

export type AdminUserIntegrations = {
  onenote?: {
    status: OneNoteConnectionStatus;
    last_synced_at?: string;
  };
};

/** Dates arrive as ISO strings. */
export type AdminUser = {
  user_id: string;
  name: string;
  email: string;
  is_admin: boolean;
  sign_in: { google: boolean; password: boolean };
  email_verified: boolean;
  created_at: string;
  /** The later of the last sign-in and the last session refresh. */
  last_active_at?: string;
  notes: AdminUserNotes;
  conversation_count: number;
  integrations: AdminUserIntegrations;
};

export type AdminUserPage = {
  users: AdminUser[];
  total: number;
  limit: number;
  offset: number;
};
