import 'dotenv/config';
import assert from 'node:assert/strict';

const DB = 'cortex_jobs_scheduler_smoke_db';
process.env.MONGO_DB_JOBS = DB;

const { MongooseConnectionManager } = await import('../src/db/mongo/mongoose_connection_manager.js');
const { MongooseJobScheduleRepository } = await import('../src/jobs_svc/repositories/mongoose_job_schedule_repository.js');
const { JobScheduler } = await import('../src/jobs_svc/job_scheduler.js');
const { ScheduleClock } = await import('../src/jobs_svc/schedule_clock.js');
const { Time } = await import('../src/lib/time.js');

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

const EVERY_MIN = { kind: 'interval', every_ms: Time.minutesToMs(1) } as const;

async function main(): Promise<void> {
  const host = process.env.MONGO_HOST ?? 'localhost';
  const port = Number(process.env.MONGO_PORT ?? 27017);
  const mgr = await MongooseConnectionManager.getInstance({ host, port });
  const conn = await mgr.getDbConnection({ db: DB });
  await conn.collection('job_schedules').deleteMany({});
  await conn.collection('jobs').deleteMany({});

  // Repositories register the models on the connection, so build them before
  // reaching for conn.model().
  const repo = await MongooseJobScheduleRepository.create();
  const scheduler = await JobScheduler.create();
  await conn.model('JobSchedule').syncIndexes();

  const seed = async (over: Record<string, unknown> = {}) => {
    await conn.collection('job_schedules').deleteMany({});
    await conn.collection('jobs').deleteMany({});
    return scheduler.upsertSchedule({
      id: 'smoke-schedule',
      name: 'smoke_scheduled',
      payload: { hello: 'world' },
      schedule: EVERY_MIN,
      ...over
    } as any);
  };

  console.log('\nregistration');
  await check('upsert is idempotent on id and keeps the pending firing', async () => {
    const first = await seed({ label: 'First' });
    const again = await scheduler.upsertSchedule({
      id: 'smoke-schedule',
      name: 'smoke_scheduled',
      payload: { hello: 'world' },
      schedule: EVERY_MIN,
      label: 'Renamed'
    } as any);

    assert.equal(await conn.collection('job_schedules').countDocuments({}), 1, 'must not duplicate');
    assert.equal(again.label, 'Renamed', 'mutable fields should update');
    assert.deepEqual(again.next_run_at, first.next_run_at, 'redeploy must not reset the clock');
  });

  console.log('\nfiring');
  await check('a due schedule materializes exactly one job', async () => {
    const s = await seed();
    const due_at = new Date(s.next_run_at.getTime() + 1000);

    assert.equal(await scheduler.tick(due_at), 1);
    const jobs = await conn.collection('jobs').find({}).toArray();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].name, 'smoke_scheduled');
    assert.equal(jobs[0].schedule_id, 'smoke-schedule', 'the job must point back at its schedule');

    const after = await repo.getById('smoke-schedule');
    assert.ok(after!.next_run_at > due_at, 'next_run_at must have advanced');
    assert.equal(after!.last_job_id, jobs[0].id, 'last_job_id must record the run');
  });

  await check('a schedule that is not yet due fires nothing', async () => {
    const s = await seed();
    assert.equal(await scheduler.tick(new Date(s.next_run_at.getTime() - 1000)), 0);
    assert.equal(await conn.collection('jobs').countDocuments({}), 0);
  });

  await check('a disabled schedule fires nothing', async () => {
    const s = await seed();
    await scheduler.setScheduleEnabled({ id: 'smoke-schedule', enabled: false });
    assert.equal(await scheduler.tick(new Date(s.next_run_at.getTime() + 1000)), 0);
  });

  await check('re-enabling does not fire the whole backlog at once', async () => {
    await seed();
    await scheduler.setScheduleEnabled({ id: 'smoke-schedule', enabled: false });
    const re = await scheduler.setScheduleEnabled({ id: 'smoke-schedule', enabled: true });
    assert.ok(re!.next_run_at > new Date(), 'next_run_at must be refreshed on re-enable');
  });

  console.log('\nconcurrency');
  await check('two containers ticking together materialize the run once', async () => {
    const s = await seed();
    const due_at = new Date(s.next_run_at.getTime() + 1000);
    const other = await JobScheduler.create();

    const [a, b] = await Promise.all([scheduler.tick(due_at), other.tick(due_at)]);
    assert.equal(a + b, 1, `expected exactly one spawn across both ticks, got ${a + b}`);
    assert.equal(await conn.collection('jobs').countDocuments({}), 1);
  });

  await check('overrun is refused by the job queue, not by a second guard', async () => {
    const s = await seed({ dedup_key: 'smoke_scheduled' });
    const due_at = new Date(s.next_run_at.getTime() + 1000);

    assert.equal(await scheduler.tick(due_at), 1, 'first window fires');

    // The previous run is still active, so the next window collides on
    // uniq_job_dedup_active and is skipped.
    const later = await repo.getById('smoke-schedule');
    const next_due = new Date(later!.next_run_at.getTime() + 1000);
    assert.equal(await scheduler.tick(next_due), 0, 'overrunning window must be skipped');
    assert.equal(await conn.collection('jobs').countDocuments({}), 1);

    const final = await repo.getById('smoke-schedule');
    assert.ok(final!.next_run_at > next_due, 'next_run_at must still advance past a skipped window');
  });

  console.log('\ncatch-up after downtime');
  await check('catchup:true fires one run for a long outage, not one per window', async () => {
    const s = await seed({ catchup: true });
    // Pretend the container was down for two hours.
    const long_after = new Date(s.next_run_at.getTime() + Time.hoursToMs(2));

    assert.equal(await scheduler.tick(long_after), 1);
    assert.equal(await conn.collection('jobs').countDocuments({}), 1, 'exactly one, not 120');

    const after = await repo.getById('smoke-schedule');
    const expected = ScheduleClock.nextRunAt({ schedule: EVERY_MIN, from: long_after });
    assert.deepEqual(after!.next_run_at, expected, 'must advance forward from now, not from the stale value');
  });

  await check('catchup:false skips the missed window but still advances', async () => {
    const s = await seed({ catchup: false });
    const long_after = new Date(s.next_run_at.getTime() + Time.hoursToMs(2));

    assert.equal(await scheduler.tick(long_after), 0, 'must not fire late');
    assert.equal(await conn.collection('jobs').countDocuments({}), 0);

    const after = await repo.getById('smoke-schedule');
    assert.ok(after!.next_run_at > long_after, 'a skipped window must not stall the schedule');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await conn.collection('job_schedules').deleteMany({});
  await conn.collection('jobs').deleteMany({});
  await mgr.disconnectAll();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
