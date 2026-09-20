import type {
  CreateOneNoteConnectionInput,
  OneNoteConnection,
  OneNoteConnectionStatus
} from '../types/onenote_connection.types.js';

export interface OneNoteConnectionRepository {
  findByUserId(user_id: string): Promise<OneNoteConnection | null>;

  /** Connecting again replaces the stored account, keeping one connection per user. */
  upsert(input: CreateOneNoteConnectionInput): Promise<OneNoteConnection>;

  /** Written only when MSAL actually rotated something. */
  updateTokenCache(params: { user_id: string; token_cache_sealed: string }): Promise<void>;

  updateSelectedNotebooks(params: { user_id: string; notebook_ids: string[] }): Promise<OneNoteConnection | null>;

  updateStatus(params: {
    user_id: string;
    status: OneNoteConnectionStatus;
    last_error?: string;
  }): Promise<void>;

  deleteByUserId(user_id: string): Promise<boolean>;
}
