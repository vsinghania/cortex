/*
 * The two OneNote job handlers, against the real JobRunContext rather than a double —
 * the properties worth testing (progress seeding, checkpointing, cancellation) are its
 * behaviour as much as theirs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OneNoteSyncJobHandler } from '../src/onenote_svc/jobs/onenote_sync_job_handler.js';
import { OneNoteSyncSweepJobHandler } from '../src/onenote_svc/jobs/onenote_sync_sweep_job_handler.js';
import { OneNoteJobName } from '../src/onenote_svc/jobs/onenote_job.types.js';
import { GraphThrottledError, OneNoteReauthRequiredError } from '../src/onenote_svc/onenote_errors.js';
import type { OneNoteSyncSvc } from '../src/onenote_svc/onenote_sync_svc.js';
import type { OneNoteSyncResult, RunSyncParams } from '../src/onenote_svc/types/onenote_sync.types.js';
import type { OneNoteConnection } from '../src/onenote_svc/types/onenote_connection.types.js';
import type { OneNoteConnectionRepository } from '../src/onenote_svc/repositories/onenote_connection_repository_interface.js';
import type { JobsSvcInterface } from '../src/jobs_svc/jobs_svc_interface.js';
import type { EnqueueInput, JobProgress } from '../src/jobs_svc/types/job.types.js';
import type { JobContext } from '../src/jobs_svc/types/job_handler.types.js';
import { ConflictError } from '../src/common/errors.js';

const USER_ID = 'user-1';

const EMPTY_STATS = { sections: 1, pages_seen: 0, created: 0, updated: 0, unchanged: 0, failed: 0 };

class FakeJobs {
  readonly enqueued: EnqueueInput[] = [];
  constructor(private readonly conflict_for = new Set<string>()) {}

  async enqueue(input: EnqueueInput) {
    if (input.user_id && this.conflict_for.has(input.user_id)) {
      throw new ConflictError('A job with this dedup key is already active');
    }
    this.enqueued.push(input);
    return { id: `job-${this.enqueued.length}` } as never;
  }
}

function context(overrides: Partial<JobContext> = {}): JobContext {
  const progress: JobProgress = { processed: 0, succeeded: 0, failed: 0 };
  const reported: JobProgress[] = [];
  const checkpoints: Record<string, unknown>[] = [];
  const errors: Array<{ item_id?: string; message: string }> = [];

  const ctx = {
    job_id: 'job-1',
    name: OneNoteJobName.OneNoteSync,
    user_id: USER_ID,
    attempt: 1,
    max_attempts: 3,
    progress,
    signal: new AbortController().signal,
    reportProgress: (p: Partial<JobProgress>) => reported.push({ ...progress, ...p }),
    recordError: (e: { item_id?: string; message: string }) => errors.push(e),
    setCheckpoint: (c: Record<string, unknown>) => checkpoints.push(c),
    ...overrides
  } as JobContext;

  return Object.assign(ctx, { reported, checkpoints, errors } as never) as JobContext & {
    reported: JobProgress[];
    checkpoints: Record<string, unknown>[];
    errors: Array<{ item_id?: string; message: string }>;
  };
}

function syncSvc(run: (params: RunSyncParams) => Promise<OneNoteSyncResult>): OneNoteSyncSvc {
  return { run } as unknown as OneNoteSyncSvc;
}

// --- the sync job ----------------------------------------------------------

test('a completed pass succeeds and enqueues nothing further', async () => {
  const jobs = new FakeJobs();
  const handler = await OneNoteSyncJobHandler.create({
    sync_svc: syncSvc(async () => ({ completed: true, stats: { ...EMPTY_STATS, created: 3 } })),
    jobs_svc: jobs as unknown as JobsSvcInterface
  });

  const result = await handler.handle({ user_id: USER_ID, mode: 'incremental', reason: 'scheduled' }, context());

  assert.equal(result.outcome, 'succeeded');
  assert.equal(jobs.enqueued.length, 0);
});

test('a paused pass hands its checkpoint to a continuation job', async () => {
  const jobs = new FakeJobs();
  const checkpoint = { section_cursor: 'sec-2', pages_seen: 40, watermark_candidate: '2026-09-10T00:00:00.000Z' };
  const handler = await OneNoteSyncJobHandler.create({
    sync_svc: syncSvc(async () => ({ completed: false, checkpoint, stats: { ...EMPTY_STATS, created: 40 } })),
    jobs_svc: jobs as unknown as JobsSvcInterface
  });
  const ctx = context() as JobContext & { checkpoints: Record<string, unknown>[] };

  const result = await handler.handle({ user_id: USER_ID, mode: 'full', reason: 'manual' }, ctx);

  assert.equal(result.outcome, 'succeeded');
  assert.equal(result.outcome === 'succeeded' && result.summary?.partial, true);
  assert.deepEqual(ctx.checkpoints.at(-1), checkpoint);

  assert.equal(jobs.enqueued.length, 1);
  const continuation = jobs.enqueued[0];
  assert.equal(continuation.name, OneNoteJobName.OneNoteSync);
  assert.deepEqual(continuation.payload, {
    user_id: USER_ID,
    mode: 'full',
    reason: 'continuation',
    notebook_ids: null,
    resume: checkpoint
  });
  assert.equal(continuation.dedup_key, undefined, 'it would collide with the job creating it');
});

test('a scoped pass stays scoped when it continues', async () => {
  const jobs = new FakeJobs();
  const handler = await OneNoteSyncJobHandler.create({
    sync_svc: syncSvc(async () => ({ completed: false, checkpoint: { pages_seen: 1 }, stats: EMPTY_STATS })),
    jobs_svc: jobs as unknown as JobsSvcInterface
  });

  await handler.handle(
    { user_id: USER_ID, mode: 'incremental', reason: 'manual', notebook_ids: ['nb-2'] },
    context()
  );

  const payload = jobs.enqueued[0].payload as { notebook_ids: string[] };
  assert.deepEqual(payload.notebook_ids, ['nb-2'], 'a continuation must not widen to every notebook');
});

test('a continuation resumes from the payload it was given', async () => {
  const seen: RunSyncParams[] = [];
  const handler = await OneNoteSyncJobHandler.create({
    sync_svc: syncSvc(async (params) => {
      seen.push(params);
      return { completed: true, stats: EMPTY_STATS };
    }),
    jobs_svc: new FakeJobs() as unknown as JobsSvcInterface
  });

  await handler.handle(
    {
      user_id: USER_ID,
      mode: 'incremental',
      reason: 'continuation',
      resume: { section_cursor: 'sec-9', pages_seen: 12, page_next_link: null, watermark_candidate: null }
    },
    context()
  );

  assert.equal(seen[0].checkpoint?.section_cursor, 'sec-9');
  assert.equal(seen[0].checkpoint?.pages_seen, 12);
  assert.equal(seen[0].checkpoint?.page_next_link, undefined, 'null from BSON reads as absent');
});

test("this job's own checkpoint beats the payload, since a retry is newer", async () => {
  const seen: RunSyncParams[] = [];
  const handler = await OneNoteSyncJobHandler.create({
    sync_svc: syncSvc(async (params) => {
      seen.push(params);
      return { completed: true, stats: EMPTY_STATS };
    }),
    jobs_svc: new FakeJobs() as unknown as JobsSvcInterface
  });

  await handler.handle(
    { user_id: USER_ID, mode: 'incremental', reason: 'continuation', resume: { section_cursor: 'stale' } },
    context({ checkpoint: { section_cursor: 'fresh' }, attempt: 2 })
  );

  assert.equal(seen[0].checkpoint?.section_cursor, 'fresh');
});

test('progress never goes backwards after a reclaim', async () => {
  const handler = await OneNoteSyncJobHandler.create({
    sync_svc: syncSvc(async (params) => {
      params.onProgress?.({ processed: 2, succeeded: 2, failed: 0 });
      return { completed: true, stats: EMPTY_STATS };
    }),
    jobs_svc: new FakeJobs() as unknown as JobsSvcInterface
  });
  const ctx = context({ progress: { processed: 100, succeeded: 100, failed: 0 }, attempt: 2 }) as JobContext & {
    reported: JobProgress[];
  };

  await handler.handle({ user_id: USER_ID, mode: 'incremental', reason: 'scheduled' }, ctx);

  assert.equal(ctx.reported.at(-1)?.processed, 100, 'seeded from what a previous attempt reported');
});

test('a dead grant fails permanently; throttling fails retryably', async () => {
  const jobs = new FakeJobs() as unknown as JobsSvcInterface;
  const reauth = await OneNoteSyncJobHandler.create({
    sync_svc: syncSvc(async () => {
      throw new OneNoteReauthRequiredError();
    }),
    jobs_svc: jobs
  });
  const throttled = await OneNoteSyncJobHandler.create({
    sync_svc: syncSvc(async () => {
      throw new GraphThrottledError('slow down', 429);
    }),
    jobs_svc: jobs
  });

  const payload = { user_id: USER_ID, mode: 'incremental' as const, reason: 'scheduled' as const };
  assert.deepEqual(await reauth.handle(payload, context()), {
    outcome: 'failed',
    reason: 'reauth_required',
    retryable: false
  });
  assert.deepEqual(await throttled.handle(payload, context()), {
    outcome: 'failed',
    reason: 'throttled',
    retryable: true
  });
});

test('a payload that came back from BSON as null still parses', async () => {
  const handler = await OneNoteSyncJobHandler.create({
    sync_svc: syncSvc(async () => ({ completed: true, stats: EMPTY_STATS })),
    jobs_svc: new FakeJobs() as unknown as JobsSvcInterface
  });

  const parsed = handler.parsePayload({ user_id: USER_ID, mode: 'full', reason: 'continuation', resume: null });
  assert.equal(parsed.resume, null);
});

// --- the sweep -------------------------------------------------------------

function connection(user_id: string): OneNoteConnection {
  return { user_id, selected_notebook_ids: ['nb-1'], status: 'connected' } as OneNoteConnection;
}

function repoWith(connections: OneNoteConnection[]): OneNoteConnectionRepository {
  return { listSyncable: async () => connections } as unknown as OneNoteConnectionRepository;
}

test('the sweep enqueues one deduped sync per connected account', async () => {
  const jobs = new FakeJobs();
  const handler = await OneNoteSyncSweepJobHandler.create({
    connection_repo: repoWith([connection('user-1'), connection('user-2')]),
    jobs_svc: jobs as unknown as JobsSvcInterface
  });

  const result = await handler.handle({}, context());

  assert.deepEqual(result.outcome === 'succeeded' && result.summary, {
    candidates: 2,
    enqueued: 2,
    already_running: 0
  });
  assert.deepEqual(jobs.enqueued.map((j) => j.dedup_key), ['onenote-sync:user-1', 'onenote-sync:user-2']);
});

test('an account whose previous sync is still running is skipped, not failed', async () => {
  const jobs = new FakeJobs(new Set(['user-1']));
  const handler = await OneNoteSyncSweepJobHandler.create({
    connection_repo: repoWith([connection('user-1'), connection('user-2')]),
    jobs_svc: jobs as unknown as JobsSvcInterface
  });

  const result = await handler.handle({}, context());

  assert.equal(result.outcome, 'succeeded', 'the dedup key rejecting is the overrun guard working');
  assert.deepEqual(result.outcome === 'succeeded' && result.summary, {
    candidates: 2,
    enqueued: 1,
    already_running: 1
  });
});

test('the sweep stops fanning out when the worker is draining', async () => {
  const controller = new AbortController();
  controller.abort();
  const jobs = new FakeJobs();
  const handler = await OneNoteSyncSweepJobHandler.create({
    connection_repo: repoWith([connection('user-1'), connection('user-2')]),
    jobs_svc: jobs as unknown as JobsSvcInterface
  });

  await handler.handle({}, context({ signal: controller.signal }));

  assert.equal(jobs.enqueued.length, 0);
});
