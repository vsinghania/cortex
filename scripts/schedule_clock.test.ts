import assert from 'node:assert/strict';
import test from 'node:test';
import { ScheduleClock } from '../src/jobs_svc/schedule_clock.js';
import { Cron } from '../src/lib/cron.js';
import { Time } from '../src/lib/time.js';

const NOW = new Date('2026-09-10T08:00:00.000Z');
const MIDNIGHT_UTC = { kind: 'cron', expression: '0 0 * * *', timezone: 'UTC' } as const;
const EVERY_15_MIN = { kind: 'interval', every_ms: Time.minutesToMs(15) } as const;

test('interval schedules advance by their period from the given instant', () => {
  const next = ScheduleClock.nextRunAt({ schedule: EVERY_15_MIN, from: NOW });
  assert.equal(next.toISOString(), '2026-09-10T08:15:00.000Z');
});

test('cron schedules advance to the next matching instant', () => {
  const next = ScheduleClock.nextRunAt({ schedule: MIDNIGHT_UTC, from: NOW });
  assert.equal(next.toISOString(), '2026-09-11T00:00:00.000Z');
});

test('a punctual tick fires and advances one window', () => {
  const decision = ScheduleClock.resolveDue({
    schedule: MIDNIGHT_UTC,
    next_run_at: new Date('2026-09-10T00:00:00.000Z'),
    now: new Date('2026-09-10T00:00:12.000Z'),
    catchup: true,
    stale_after_ms: Time.secondsToMs(60)
  });

  assert.equal(decision.spawn, true);
  assert.equal(decision.next_run_at.toISOString(), '2026-09-11T00:00:00.000Z');
  assert.equal(decision.lateness_ms, 12_000);
});

test('catch-up after downtime fires exactly one run, not one per missed window', () => {
  // Down for three days: next_run_at is 09-07, now is 09-10.
  const decision = ScheduleClock.resolveDue({
    schedule: MIDNIGHT_UTC,
    next_run_at: new Date('2026-09-07T00:00:00.000Z'),
    now: NOW,
    catchup: true,
    stale_after_ms: Time.secondsToMs(60)
  });

  assert.equal(decision.spawn, true, 'the missed window should still run');
  // Computed forward from now, so the three missed nights do not queue up.
  assert.equal(decision.next_run_at.toISOString(), '2026-09-11T00:00:00.000Z');
});

test('catchup:false skips a missed window rather than firing it late', () => {
  const decision = ScheduleClock.resolveDue({
    schedule: MIDNIGHT_UTC,
    next_run_at: new Date('2026-09-07T00:00:00.000Z'),
    now: NOW,
    catchup: false,
    stale_after_ms: Time.secondsToMs(60)
  });

  assert.equal(decision.spawn, false, 'a midnight sweep must not start at 08:00');
  assert.equal(decision.next_run_at.toISOString(), '2026-09-11T00:00:00.000Z', 'but it must still advance');
});

test('catchup:false still fires a merely-jittery tick', () => {
  // Within tolerance: this is ordinary scheduler jitter, not downtime.
  const decision = ScheduleClock.resolveDue({
    schedule: EVERY_15_MIN,
    next_run_at: new Date('2026-09-10T07:59:30.000Z'),
    now: NOW,
    catchup: false,
    stale_after_ms: Time.secondsToMs(60)
  });

  assert.equal(decision.spawn, true);
  assert.equal(decision.lateness_ms, 30_000);
});

test('the stale boundary is exclusive, so exactly-tolerance still fires', () => {
  const decision = ScheduleClock.resolveDue({
    schedule: EVERY_15_MIN,
    next_run_at: new Date('2026-09-10T07:59:00.000Z'),
    now: NOW,
    catchup: false,
    stale_after_ms: Time.secondsToMs(60)
  });
  assert.equal(decision.spawn, true);
});

test('a cron timezone shifts the firing instant', () => {
  const ist = ScheduleClock.nextRunAt({
    schedule: { kind: 'cron', expression: '0 0 * * *', timezone: 'Asia/Kolkata' },
    from: NOW
  });
  // Midnight IST is 18:30 UTC the previous day.
  assert.equal(ist.toISOString(), '2026-09-10T18:30:00.000Z');
});

test('assertValid rejects a nonsense cron and a non-positive interval', () => {
  assert.throws(() => ScheduleClock.assertValid({ kind: 'cron', expression: 'not a cron' }), /Invalid cron/);
  assert.throws(() => ScheduleClock.assertValid({ kind: 'interval', every_ms: 0 }), /must be positive/);
  assert.throws(() => ScheduleClock.assertValid({ kind: 'interval', every_ms: -1 }), /must be positive/);
});

test('Cron.isValid separates parseable expressions from junk', () => {
  assert.equal(Cron.isValid('*/5 * * * *'), true);
  assert.equal(Cron.isValid('0 3 * * *'), true);
  assert.equal(Cron.isValid('every tuesday'), false);
});
