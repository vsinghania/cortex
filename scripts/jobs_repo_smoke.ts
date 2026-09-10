import 'dotenv/config';
import assert from 'node:assert/strict';
import { MongooseJobRepository } from '../src/jobs_svc/repositories/mongoose_job_repository.js';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { JobStatus, type Job } from '../src/jobs_svc/types/job.types.js';
import { Id } from '../src/lib/id.js';
import { Time } from '../src/lib/time.js';

const DB = 'cortex_jobs_smoke_db';
const LEASE_MS = Time.minutesToMs(2);

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

function buildJob(over: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id: Id.generateUuidV7(),
    name: 'smoke_job',
    payload: { hello: 'world' },
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
  // Indexes are built lazily; force them so the unique partial index is live.
  await conn.model('Job').syncIndexes();

  console.log('\nindexes');
  await check('job_claim, uniq_job_dedup_active, job_ttl and the read indexes exist', async () => {
    const names = (await conn.collection('jobs').indexes()).map((i: any) => i.name).sort();
    for (const expected of [
      'job_claim',
      'uniq_job_dedup_active',
      'job_ttl',
      'by_name_created',
      'by_schedule_created'
    ]) {
      assert.ok(names.includes(expected), `missing index ${expected}; have ${names.join(', ')}`);
    }
  });

  await check('an empty payload survives the round trip', async () => {
    // Mongoose minimize strips empty objects on save, after validation, so this
    // silently lost `payload` on the create() path while the upsert path kept it.
    await conn.collection('jobs').deleteMany({});
    const job = buildJob({ payload: {} });
    await repo.enqueue({ job });

    const stored = await repo.getById(job.id);
    assert.deepEqual(stored!.payload, {}, 'payload must not vanish');

    const raw = await conn.collection('jobs').findOne({ id: job.id });
    assert.ok('payload' in raw!, 'the field itself must be present, not merely empty');
  });

  console.log('\nclaim');
  await check('two workers racing claim different jobs, never the same one', async () => {
    await conn.collection('jobs').deleteMany({});
    await repo.enqueue({ job: buildJob() });
    await repo.enqueue({ job: buildJob() });

    const now = new Date();
    const [a, b] = await Promise.all([
      repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now }),
      repo.claimNext({ worker_id: 'ctr-b', lease_ms: LEASE_MS, now })
    ]);

    assert.ok(a && b, 'both workers should get a job');
    assert.notEqual(a!.id, b!.id, 'workers claimed the SAME job - claim is not atomic');
    assert.equal(a!.attempts, 1);
    assert.equal(a!.status, JobStatus.Running);
  });

  await check('a claimed job is invisible until its lease lapses', async () => {
    await conn.collection('jobs').deleteMany({});
    await repo.enqueue({ job: buildJob() });
    const now = new Date();

    assert.ok(await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now }));
    assert.equal(await repo.claimNext({ worker_id: 'ctr-b', lease_ms: LEASE_MS, now }), null);
  });

  await check('an expired lease is reclaimed by the claim itself, with no reaper', async () => {
    await conn.collection('jobs').deleteMany({});
    const job = buildJob();
    await repo.enqueue({ job });

    const t0 = new Date();
    const first = await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now: t0 });

    const after_expiry = new Date(t0.getTime() + LEASE_MS + 1000);
    const reclaimed = await repo.claimNext({ worker_id: 'ctr-b', lease_ms: LEASE_MS, now: after_expiry });

    assert.ok(reclaimed, 'expired lease was not reclaimed');
    assert.equal(reclaimed!.id, job.id);
    assert.equal(reclaimed!.locked_by, 'ctr-b');
    assert.equal(reclaimed!.reclaimed_count, 1, 'reclaim was not counted');
    assert.equal(reclaimed!.attempts, 2, 'reclaim should burn an attempt (poison-job ceiling)');
    // $ifNull: the first claim stamps started_at and a reclaim must not move it.
    assert.deepEqual(reclaimed!.started_at, first!.started_at, 'started_at must survive the reclaim');
    assert.deepEqual(reclaimed!.started_at, t0);
  });

  await check('a future run_at is not claimable yet', async () => {
    await conn.collection('jobs').deleteMany({});
    const now = new Date();
    const later = new Date(now.getTime() + Time.minutesToMs(5));
    await repo.enqueue({ job: buildJob({ run_at: later, visible_at: later }) });

    assert.equal(await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now }), null);
    assert.ok(await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now: later }));
  });

  console.log('\nfencing');
  await check('a stalled worker cannot complete a job that was reclaimed', async () => {
    await conn.collection('jobs').deleteMany({});
    const job = buildJob();
    await repo.enqueue({ job });

    const t0 = new Date();
    await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now: t0 });
    const after_expiry = new Date(t0.getTime() + LEASE_MS + 1000);
    await repo.claimNext({ worker_id: 'ctr-b', lease_ms: LEASE_MS, now: after_expiry });

    const stale_write = await repo.complete({
      job_id: job.id,
      worker_id: 'ctr-a',
      now: after_expiry,
      retention_sec: 60
    });
    assert.equal(stale_write, false, 'the zombie worker overwrote the new owner');

    const still_running = await repo.getById(job.id);
    assert.equal(still_running!.status, JobStatus.Running);
    assert.equal(still_running!.locked_by, 'ctr-b');
  });

  await check('a lost lease surfaces as a null heartbeat', async () => {
    await conn.collection('jobs').deleteMany({});
    const job = buildJob();
    await repo.enqueue({ job });

    const t0 = new Date();
    await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now: t0 });
    const after_expiry = new Date(t0.getTime() + LEASE_MS + 1000);
    await repo.claimNext({ worker_id: 'ctr-b', lease_ms: LEASE_MS, now: after_expiry });

    const beat = await repo.heartbeat({
      job_id: job.id,
      worker_id: 'ctr-a',
      now: after_expiry,
      lease_ms: LEASE_MS
    });
    assert.equal(beat, null, 'heartbeat must return null once the lease is lost');
  });

  console.log('\nsingle-flight');
  await check('a second active job with the same dedup key is refused', async () => {
    await conn.collection('jobs').deleteMany({});
    const first = await repo.enqueue({ job: buildJob({ dedup_key: 'sweep', dedup_active: true }) });
    const second = await repo.enqueue({ job: buildJob({ dedup_key: 'sweep', dedup_active: true }) });

    assert.equal(first.created, true);
    assert.equal(second.created, false, 'duplicate enqueue was allowed');
    assert.equal(second.job.id, first.job.id, 'should return the job already holding the key');
    assert.equal(await conn.collection('jobs').countDocuments({}), 1);
  });

  await check('the lock spans the run, not just the queued window', async () => {
    await conn.collection('jobs').deleteMany({});
    await repo.enqueue({ job: buildJob({ dedup_key: 'sweep', dedup_active: true }) });
    await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now: new Date() });

    const during = await repo.enqueue({ job: buildJob({ dedup_key: 'sweep', dedup_active: true }) });
    assert.equal(during.created, false, 'a second sweep was enqueued while one was running');
  });

  await check('the same key scoped to two users does not collide', async () => {
    await conn.collection('jobs').deleteMany({});
    const xyz = await repo.enqueue({
      job: buildJob({ dedup_key: 'reindex', dedup_active: true, user_id: 'xyz' })
    });
    const abc = await repo.enqueue({
      job: buildJob({ dedup_key: 'reindex', dedup_active: true, user_id: 'abc' })
    });

    assert.equal(xyz.created, true);
    assert.equal(abc.created, true, 'per-user scoping failed - abc collided with xyz');
  });

  await check('finishing a job frees the key for the next enqueue', async () => {
    await conn.collection('jobs').deleteMany({});
    const job = buildJob({ dedup_key: 'sweep', dedup_active: true });
    await repo.enqueue({ job });

    const now = new Date();
    await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now });
    await repo.complete({ job_id: job.id, worker_id: 'ctr-a', now, retention_sec: 60 });

    const done = await repo.getById(job.id);
    assert.equal(done!.status, JobStatus.Succeeded);
    assert.equal((done as any).dedup_active, undefined, 'dedup_active must be unset at terminal');
    assert.ok(done!.expires_at, 'expires_at must be set to arm the TTL');

    const next = await repo.enqueue({ job: buildJob({ dedup_key: 'sweep', dedup_active: true }) });
    assert.equal(next.created, true, 'the key was not released');
  });

  console.log('\nrelease and cancel');
  await check('release hands the job back without burning an attempt', async () => {
    await conn.collection('jobs').deleteMany({});
    const job = buildJob();
    await repo.enqueue({ job });

    const now = new Date();
    const claimed = await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now });
    assert.equal(claimed!.attempts, 1);

    await repo.release({
      job_id: job.id,
      worker_id: 'ctr-a',
      now,
      checkpoint: { after_id: 'note-42' }
    });

    const released = await repo.getById(job.id);
    assert.equal(released!.status, JobStatus.Queued);
    assert.equal(released!.attempts, 1, 'release must not burn an attempt');
    assert.equal(released!.locked_by, null);
    assert.deepEqual(released!.checkpoint, { after_id: 'note-42' });

    assert.ok(await repo.claimNext({ worker_id: 'ctr-b', lease_ms: LEASE_MS, now }));
  });

  await check('a queued job cancels outright; a running one is only flagged', async () => {
    await conn.collection('jobs').deleteMany({});
    const queued = buildJob();
    const running = buildJob();
    await repo.enqueue({ job: queued });
    await repo.enqueue({ job: running });

    const now = new Date();
    const cancelled = await repo.requestCancel({ job_id: queued.id, now, retention_sec: 60 });
    assert.equal(cancelled!.status, JobStatus.Cancelled);

    await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now });
    const flagged = await repo.requestCancel({ job_id: running.id, now, retention_sec: 60 });
    assert.equal(flagged!.status, JobStatus.Running);
    assert.equal(flagged!.cancel_requested, true);

    const beat = await repo.heartbeat({
      job_id: running.id,
      worker_id: 'ctr-a',
      now,
      lease_ms: LEASE_MS
    });
    assert.equal(beat!.cancel_requested, true, 'the worker must see the cancel on its heartbeat');
  });

  console.log('\nheartbeat');
  await check('heartbeat extends the lease and flushes progress', async () => {
    await conn.collection('jobs').deleteMany({});
    const job = buildJob();
    await repo.enqueue({ job });

    const t0 = new Date();
    await repo.claimNext({ worker_id: 'ctr-a', lease_ms: LEASE_MS, now: t0 });

    const t1 = new Date(t0.getTime() + Time.secondsToMs(30));
    await repo.heartbeat({
      job_id: job.id,
      worker_id: 'ctr-a',
      now: t1,
      lease_ms: LEASE_MS,
      progress: { processed: 12, succeeded: 11, failed: 1, total: 100 },
      checkpoint: { after_id: 'note-12' }
    });

    const beaten = await repo.getById(job.id);
    assert.equal(beaten!.progress.processed, 12);
    assert.equal(beaten!.progress.total, 100);
    assert.deepEqual(beaten!.checkpoint, { after_id: 'note-12' });
    assert.deepEqual(beaten!.visible_at, new Date(t1.getTime() + LEASE_MS));
    assert.deepEqual(beaten!.lease_expires_at, beaten!.visible_at);
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
