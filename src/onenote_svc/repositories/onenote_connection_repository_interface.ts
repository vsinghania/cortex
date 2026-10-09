import type {
  CreateOneNoteConnectionInput,
  OneNoteConnection,
  OneNoteConnectionStatus,
  OneNoteConnectionSummary
} from '../types/onenote_connection.types.js';

export interface OneNoteConnectionRepository {
  findByUserId(user_id: string): Promise<OneNoteConnection | null>;

  /** Connecting again replaces the stored account, keeping one connection per user. */
  upsertConnection(input: CreateOneNoteConnectionInput): Promise<OneNoteConnection>;

  /** Written only when MSAL actually rotated something. */
  updateTokenCache(params: { user_id: string; token_cache_sealed: string }): Promise<void>;

  /** Connections the sweep should enqueue: connected, and with something chosen to sync. */
  listSyncableConnections(params: { limit: number }): Promise<OneNoteConnection[]>;

  updateSelectedNotebooks(params: { user_id: string; notebook_ids: string[] }): Promise<OneNoteConnection | null>;

  /**
   * Replaces the cached notebook list, keeping each surviving notebook's sync state.
   * A notebook gone from Graph drops out; its imported notes are left alone.
   */
  cacheNotebooks(params: {
    user_id: string;
    notebooks: Array<{ id: string; display_name: string }>;
    cached_at: Date;
  }): Promise<OneNoteConnection | null>;

  /** Per notebook, and only for one a pass read to the end; see OneNoteSyncSvc. */
  updateNotebookSyncState(params: {
    user_id: string;
    notebook_id: string;
    sync_watermark?: Date;
    last_synced_at: Date;
  }): Promise<OneNoteConnection | null>;

  /** Records why one notebook's pass failed, and how many times running. */
  recordNotebookFailure(params: {
    user_id: string;
    notebook_id: string;
    reason: string;
    at: Date;
  }): Promise<OneNoteConnection | null>;

  updateSyncState(params: {
    user_id: string;
    sync_watermark?: Date;
    last_synced_at?: Date;
  }): Promise<OneNoteConnection | null>;

  updateStatus(params: {
    user_id: string;
    status: OneNoteConnectionStatus;
    last_error?: string;
  }): Promise<void>;

  deleteByUserId(user_id: string): Promise<boolean>;

  /** Admin-only and NOT user-scoped: summaries for a page of users in the admin users view. */
  listSummariesByUserIds(user_ids: string[]): Promise<OneNoteConnectionSummary[]>;
}
