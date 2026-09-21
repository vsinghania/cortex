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
  /** The account's notebooks as the server last read them, with each one's sync state. */
  notebooks: OneNoteNotebookState[];
  status: OneNoteConnectionStatus;
  last_error?: string;
  last_error_at?: string;
  sync_watermark?: string;
  last_synced_at?: string;
  last_full_reconcile_at?: string;
  created_at: string;
  updated_at: string;
};

/** A sync already running, so a reloaded page can pick it back up. */
export type OneNoteActiveSync = {
  job_id: string;
  status: OneNoteJobStatus;
  progress: { total?: number; processed: number; succeeded: number; failed: number };
  /** Which notebooks the run covers; null means every selected one. */
  notebook_ids: string[] | null;
};

/** `available` is false when the server has no Microsoft credentials configured. */
export type OneNoteStatus = {
  available: boolean;
  connection: OneNoteConnection | null;
  active_sync: OneNoteActiveSync | null;
};

export type OneNoteNotebookState = {
  id: string;
  display_name: string;
  /** Each notebook syncs on its own watermark, so each has its own last-synced time. */
  last_synced_at?: string;
  sync_watermark?: string;
};

export type OneNoteNotebook = OneNoteNotebookState & {
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
