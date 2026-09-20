import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient } from './api_client';
import type { OneNoteSyncJob } from './onenote.types';

const POLL_INTERVAL_MS = 2000;
const ACTIVE_STATUSES = new Set(['queued', 'running']);

export type OneNoteSyncState = {
  job: OneNoteSyncJob | null;
  running: boolean;
  error: string | null;
  start: (mode?: 'incremental' | 'full') => Promise<void>;
};

/**
 * Starts a sync and follows it. A pass that exceeds its budget finishes as `succeeded`
 * with a partial result and enqueues a follow-up job we are not tracking, so the count
 * shown is this segment's, not the whole import's.
 */
export function useOneNoteSync(params: { onFinished?: () => void } = {}): OneNoteSyncState {
  const [job, set_job] = useState<OneNoteSyncJob | null>(null);
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

  const start = useCallback(
    async (mode: 'incremental' | 'full' = 'incremental') => {
      clear();
      set_error(null);
      try {
        const started = await ApiClient.startOneNoteSync(mode);
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

  return { job, running: !!job && ACTIVE_STATUSES.has(job.status), error, start };
}
