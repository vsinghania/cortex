/** What a sync pass carries between attempts, and what it reports when it stops. */

export type OneNoteSyncMode = 'incremental' | 'full';

/**
 * Enough to resume in a later process. Sections are walked in id order, so the cursor is
 * the last one fully drained; `page_next_link` resumes mid-section from Graph's own
 * opaque link.
 */
export type OneNoteSyncCheckpoint = {
  /** The last notebook fully drained; notebooks are walked in id order. */
  notebook_cursor?: string;
  section_cursor?: string;
  page_next_link?: string;
  /** ISO. Promoted to the connection's watermark only when a pass completes. */
  watermark_candidate?: string;
  pages_seen?: number;
};

export type OneNoteSyncStats = {
  notebooks: number;
  sections: number;
  pages_seen: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
};

export type OneNoteSyncResult = {
  /** False when the wall-clock budget ran out; the caller re-enqueues from `checkpoint`. */
  completed: boolean;
  checkpoint?: OneNoteSyncCheckpoint;
  stats: OneNoteSyncStats;
};

export type OneNoteSyncProgress = {
  processed: number;
  succeeded: number;
  failed: number;
};

export type RunSyncParams = {
  user_id: string;
  mode: OneNoteSyncMode;
  /**
   * Limits the pass to these notebooks. Safe because each notebook keeps its own
   * watermark, so syncing one never advances another's past unread changes.
   */
  notebook_ids?: string[];
  signal?: AbortSignal;
  /** Wall-clock ceiling for this attempt; the job re-enqueues itself past it. */
  budget_ms?: number;
  checkpoint?: OneNoteSyncCheckpoint;
  onProgress?: (progress: OneNoteSyncProgress) => void;
  /**
   * Called as the walk advances, so a run that dies mid-pass is resumed rather than
   * restarted. Without it a reclaimed job re-reads everything it had already done.
   */
  onCheckpoint?: (checkpoint: OneNoteSyncCheckpoint) => void;
  onError?: (entry: { item_id: string; message: string }) => void;
};
