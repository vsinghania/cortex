import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient } from './api_client';
import type { OneNoteActiveSync, OneNoteSyncJob } from './onenote.types';

const POLL_INTERVAL_MS = 2000;
const ACTIVE_STATUSES = new Set(['queued', 'running']);

export type StartSyncOptions = {
  mode?: 'incremental' | 'full';
  /** Absent means every selected notebook; naming one scopes the pass to it. */
  notebook_ids?: string[];
};

export type OneNoteSyncState = {
  job: OneNoteSyncJob | null;
  running: boolean;
  /** Which notebooks the running pass covers; null means all of them. */
  scope: string[] | null;
  error: string | null;
  start: (options?: StartSyncOptions) => Promise<void>;
};

/**
 * Starts a sync and follows it. A pass that exceeds its budget finishes as `succeeded`
 * with a partial result and enqueues a follow-up job we are not tracking, so the count
 * shown is this segment's, not the whole import's.
 */
export function useOneNoteSync(
  params: { onFinished?: () => void; active?: OneNoteActiveSync | null } = {}
): OneNoteSyncState {
  const [job, set_job] = useState<OneNoteSyncJob | null>(null);
  const [scope, set_scope] = useState<string[] | null>(null);
  const [error, set_error] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const on_finished = useRef(params.onFinished);
  on_finished.current = params.onFinished;

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Stop polling when the component goes away, or a closed settings page keeps asking.
  useEffect(() => clear, [clear]);

  const poll = useCallback(
    async (job_id: string) => {
      try {
        const { job: latest } = await ApiClient.getOneNoteSyncJob(job_id);
        set_job(latest);

        if (ACTIVE_STATUSES.has(latest.status)) {
          timer.current = window.setTimeout(() => void poll(job_id), POLL_INTERVAL_MS);
          return;
        }
        if (latest.status === 'failed') {
          set_error(
            latest.last_error === 'reauth_required'
              ? 'Microsoft access expired. Connect again to resume syncing.'
              : "The sync didn't finish. It will be retried automatically."
          );
        }
        on_finished.current?.();
      } catch {
        set_error("We lost track of the sync. Reload to see where it got to.");
      }
    },
    []
  );

  /**
   * Pick up a run the server says is already going — the case where a sync was started,
   * then the page reloaded. Guarded by a ref so a status refresh mid-run does not
   * restart the poll loop on top of itself.
   */
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    const active = params.active;
    if (!active || adopted.current === active.job_id) return;
    adopted.current = active.job_id;
    set_scope(active.notebook_ids);
    void poll(active.job_id);
  }, [params.active, poll]);

  const start = useCallback(
    async (options: StartSyncOptions = {}) => {
      clear();
      adopted.current = null;
      set_error(null);
      set_scope(options.notebook_ids ?? null);
      try {
        const started = await ApiClient.startOneNoteSync(options);
        if (!started.job_id) {
          // Already running and the running job could not be named; the next poll of
          // the connection will show its result.
          set_error('A sync is already running.');
          return;
        }
        await poll(started.job_id);
      } catch (err) {
        set_error(err instanceof Error ? err.message : "We couldn't start the sync.");
      }
    },
    [clear, poll]
  );

  return { job, scope, running: !!job && ACTIVE_STATUSES.has(job.status), error, start };
}
