import 'dotenv/config';
import assert from 'node:assert/strict';
import { MongooseJobRepository } from '../src/jobs_svc/repositories/mongoose_job_repository.js';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { JobHandlerRegistry } from '../src/jobs_svc/handlers/job_handler_registry.js';
import { JobWorker } from '../src/jobs_svc/worker/job_worker.js';
import { PermanentJobError } from '../src/jobs_svc/job_errors.js';
import { JobStatus, type Job, type JobPayload } from '../src/jobs_svc/types/job.types.js';
import type { JobContext, JobHandler, JobResult } from '../src/jobs_svc/types/job_handler.types.js';
import { Id } from '../src/lib/id.js';
import { Time } from '../src/lib/time.js';

const DB = 'cortex_jobs_worker_smoke_db';

let passed = 0;
let failed = 0;

async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok   ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL ${label}`);
    console.error(`       ${(err as Error).message}`);
    failed++;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn: () => Promise<boolean>, timeout_ms = 8000): Promise<void> {
  const deadline = Date.now() + timeout_ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error('timed out waiting for condition');
}

/** A handler whose behaviour each test drives through a mutable hook. */
class ScriptedHandler implements JobHandler<JobPayload> {
  runs = 0;
  constructor(
    readonly name: string,
    private readonly run: (payload: JobPayload, ctx: JobContext) => Promise<JobResult>,
    readonly lease_ms?: number,
    readonly retry_policy?: JobHandler['retry_policy']
  ) {}

  parsePayload(raw: JobPayload): JobPayload {
    return raw;
  }

  async handle(payload: JobPayload, ctx: JobContext): Promise<JobResult> {
    this.runs++;
    return this.run(payload, ctx);
  }
}

function buildJob(name: string, over: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id: Id.generateUuidV7(),
    name,
    payload: {},
    status: JobStatus.Queued,
    attempts: 0,
    max_attempts: 3,
    run_at: now,
    visible_at: now,
    locked_by: null,
    locked_at: null,
    lease_expires_at: null,
    reclaimed_count: 0,
    cancel_requested: false,
    progress: { processed: 0, succeeded: 0, failed: 0 },
    errors: [],
    created_at: now,
    updated_at: now,
    ...over
  };
}

async function main(): Promise<void> {
  const host = process.env.MONGO_HOST ?? 'localhost';
  const port = Number(process.env.MONGO_PORT ?? 27017);
  await MongooseConnectionManager.getInstance({ host, port });

  const repo = await MongooseJobRepository.create({ db: DB });
  const mgr = await MongooseConnectionManager.getInstance();
  const conn = await mgr.getDbConnection({ db: DB });
  await conn.collection('jobs').deleteMany({});
  await conn.model('Job').syncIndexes();

  const registry = JobHandlerRegistry.getInstance();

  const ok_handler = new ScriptedHandler('smoke_ok', async () => ({
    outcome: 'succeeded',
    summary: { processed: 3 }
  }));
  const flaky_handler = new ScriptedHandler('smoke_flaky', async function (this: void) {
    throw new Error('transient');
  });
  const permanent_handler = new ScriptedHandler('smoke_permanent', async () => {
    throw new PermanentJobError('bad payload');
  });
  const slow_handler = new ScriptedHandler(
    'smoke_slow',
    async (_payload, ctx) => {
      let processed = ctx.progress.processed;
      while (!ctx.signal.aborted && processed < 500) {
        processed++;
        ctx.reportProgress({ processed });
        ctx.setCheckpoint({ after_id: `item-${processed}` });
        await sleep(20);
      }
      return { outcome: 'succeeded', summary: { processed } };
    },
    // Short on purpose: the heartbeat is min(lease/3, 10s), and it is the heartbeat
    // that flushes progress, so a longer lease would leave nothing observable
    // mid-run for a job this brief.
    Time.secondsToMs(3)
  );

  registry.registerMany([ok_handler, flaky_handler, permanent_handler, slow_handler]);

  const worker = await JobWorker.create({
    repo,
    registry,
    config: { poll_interval_ms: 100, concurrency: 2, lease_ms: Time.secondsToMs(30) }
  });
  worker.start();

  console.log('\nhappy path');
  await check('a queued job is claimed, run and completed', async () => {
    const job = buildJob('smoke_ok');
    await repo.enqueue({ job });

    await waitFor(async () => (await repo.getById(job.id))?.status === JobStatus.Succeeded);
    const done = await repo.getById(job.id);
    assert.equal(done!.attempts, 1);
    assert.deepEqual(done!.result, { processed: 3 });
    assert.ok(done!.finished_at);
    assert.ok(done!.expires_at, 'TTL must be armed');
    assert.equal((done as any).dedup_active, undefined);
  });

  console.log('\nretry and failure');
  await check('a transient throw retries with backoff, then dead-letters', async () => {
    const job = buildJob('smoke_flaky', { max_attempts: 2 });
    await repo.enqueue({ job });

    await waitFor(async () => (await repo.getById(job.id))?.status === JobStatus.Failed, 20000);
    const done = await repo.getById(job.id);
    assert.equal(done!.attempts, 2, 'should have used its whole attempt budget');
    assert.match(done!.last_error ?? '', /transient/);
  });

  await check('a PermanentJobError fails on the first attempt, without retrying', async () => {
    const job = buildJob('smoke_permanent', { max_attempts: 5 });
    await repo.enqueue({ job });

    await waitFor(async () => (await repo.getById(job.id))?.status === JobStatus.Failed);
    const done = await repo.getById(job.id);
    assert.equal(done!.attempts, 1, 'a permanent error must not consume retries');
    assert.match(done!.last_error ?? '', /bad payload/);
  });

  console.log('\nunknown handler');
  await check('a job with no registered handler is released, not failed', async () => {
    const job = buildJob('smoke_unregistered');
    await repo.enqueue({ job });

    await waitFor(async () => {
      const current = await repo.getById(job.id);
      return current?.status === JobStatus.Queued && current.locked_by === null && current.attempts >= 1;
    });

    const released = await repo.getById(job.id);
    assert.equal(released!.status, JobStatus.Queued, 'must go back to queued, never failed');
    assert.ok(released!.run_at.getTime() > Date.now(), 'should be deferred, not hot-looped');
  });

  console.log('\ncancellation');
  await check('cancelling a running job stops it and keeps the work already done', async () => {
    const job = buildJob('smoke_slow');
    await repo.enqueue({ job });

    await waitFor(async () => ((await repo.getById(job.id))?.progress.processed ?? 0) > 2);
    await repo.requestCancel({ job_id: job.id, now: new Date(), retention_sec: 60 });

    await waitFor(async () => (await repo.getById(job.id))?.status === JobStatus.Cancelled, 20000);
    const cancelled = await repo.getById(job.id);
    assert.ok(cancelled!.progress.processed > 0, 'progress already made must be kept');
    assert.ok(cancelled!.progress.processed < 500, 'should have stopped early');
  });

  console.log('\ndrain and resume');
  await check('SIGTERM releases in-flight work with its checkpoint, burning no attempt', async () => {
    const job = buildJob('smoke_slow');
    await repo.enqueue({ job });

    await waitFor(async () => ((await repo.getById(job.id))?.progress.processed ?? 0) > 2);
    await worker.stop();

    const released = await repo.getById(job.id);
    assert.equal(released!.status, JobStatus.Queued, 'drain must hand the job back');
    assert.equal(released!.locked_by, null);
    assert.equal(released!.attempts, 1, 'a graceful hand-back must not burn an attempt');
    assert.ok(released!.checkpoint, 'the checkpoint must be flushed on drain');
    assert.ok((released!.checkpoint as any).after_id, 'checkpoint should carry the resume cursor');
  });

  await check('a restarted worker resumes from the checkpoint instead of restarting', async () => {
    const stale = await conn.collection('jobs').findOne({ name: 'smoke_slow', status: JobStatus.Queued });
    assert.ok(stale, 'expected the drained job from the previous check');
    const resumed_from = (stale!.checkpoint as any).after_id as string;
    const progress_before = stale!.progress.processed as number;

    const worker_two = await JobWorker.create({
      repo,
      registry,
      config: { poll_interval_ms: 100, concurrency: 1, lease_ms: Time.secondsToMs(30) }
    });
    worker_two.start();

    await waitFor(async () => {
      const current = await repo.getById(stale!.id);
      return (current?.progress.processed ?? 0) > progress_before;
    });

    const running = await repo.getById(stale!.id);
    assert.ok(
      running!.progress.processed > progress_before,
      `processed went backwards: ${running!.progress.processed} <= ${progress_before}`
    );
    assert.notEqual((running!.checkpoint as any).after_id, resumed_from, 'checkpoint should advance');
    assert.equal(running!.attempts, 2, 'the resume is a fresh claim, so one more attempt');

    await worker_two.stop();
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await conn.collection('jobs').deleteMany({});
  await mgr.disconnectAll();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
