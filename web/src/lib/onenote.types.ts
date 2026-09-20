export type OneNoteConnectionStatus = 'connected' | 'needs_reauth' | 'error';

/** Dates arrive as ISO strings; nothing here is ever the sealed token cache. */
export type OneNoteConnection = {
  id: string;
  user_id: string;
  microsoft_email: string;
  microsoft_name?: string;
  scopes: string[];
  /** Empty means not set up yet: nothing syncs until at least one is chosen. */
  selected_notebook_ids: string[];
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

export type OneNoteNotebook = {
  id: string;
  display_name: string;
  selected: boolean;
};

export type OneNoteJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type OneNoteSyncJob = {
  id: string;
  status: OneNoteJobStatus;
  progress: { total?: number; processed: number; succeeded: number; failed: number };
  result: Record<string, unknown> | null;
  last_error: string | null;
  finished_at: string | null;
};

/** `job_id` is null only when a sync was already running and could not be identified. */
export type OneNoteSyncStart = {
  job_id: string | null;
  already_running: boolean;
};
