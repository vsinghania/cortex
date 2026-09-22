export type OneNoteConnectionStatus = 'connected' | 'needs_reauth' | 'error';

/** Dates arrive as ISO strings; nothing here is ever the sealed token cache. */
export type OneNoteConnection = {
  id: string;
  user_id: string;
  microsoft_email: string;
  microsoft_name?: string;
  scopes: string[];
  status: OneNoteConnectionStatus;
  last_error?: string;
  last_error_at?: string;
  sync_watermark?: string;
  last_synced_at?: string;
  last_full_reconcile_at?: string;
  created_at: string;
  updated_at: string;
};

/** `available` is false when the server has no Microsoft credentials configured. */
export type OneNoteStatus = {
  available: boolean;
  connection: OneNoteConnection | null;
};
