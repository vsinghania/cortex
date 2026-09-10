import assert from 'node:assert/strict';
import test from 'node:test';
import { ScheduleClock } from '../src/jobs_svc/schedule_clock.js';
import { Cron } from '../src/lib/cron.js';
import { Time } from '../src/lib/time.js';

const NOW = new Date('2026-09-10T08:00:00.000Z');
const MIDNIGHT_UTC = { kind: 'cron', expression: '0 0 * * *', timezone: 'UTC' } as const;
const EVERY_15_MIN = { kind: 'interval', every_ms: Time.minutesToMs(15) } as const;

test('interval schedules advance by their period from the given instant', () => {
  assert.equal(
    ScheduleClock.nextRunAt({ schedule: EVERY_15_MIN, from: NOW }).toISOString(),
    '2026-09-10T08:15:00.000Z'
  );
});

test('cron schedules advance to the next matching instant', () => {
  assert.equal(
    ScheduleClock.nextRunAt({ schedule: MIDNIGHT_UTC, from: NOW }).toISOString(),
    '2026-09-11T00:00:00.000Z'
  );
});

test('advancing after a long outage skips the missed windows rather than queueing them', () => {
  // next_run_at is three days stale; the next firing is tomorrow, not three days ago.
  const next = ScheduleClock.nextRunAt({ schedule: MIDNIGHT_UTC, from: NOW });
  assert.equal(next.toISOString(), '2026-09-11T00:00:00.000Z');
});

test('a cron timezone shifts the firing instant', () => {
  const ist = ScheduleClock.nextRunAt({
    schedule: { kind: 'cron', expression: '0 0 * * *', timezone: 'Asia/Kolkata' },
    from: NOW
  });
  // Midnight IST is 18:30 UTC the previous day.
  assert.equal(ist.toISOString(), '2026-09-10T18:30:00.000Z');
});

test('no max_delay_ms means no deadline - run it whenever', () => {
  assert.equal(ScheduleClock.deadlineFor({ window: NOW }), undefined);
});

test('the deadline is measured from the window, not from now', () => {
  // "no more than 30 minutes after the 08:00 slot" must mean the same thing
  // whether the scheduler was punctual or an hour late.
  const deadline = ScheduleClock.deadlineFor({ window: NOW, max_delay_ms: Time.minutesToMs(30) });
  assert.equal(deadline!.toISOString(), '2026-09-10T08:30:00.000Z');
});

test('a zero delay is still a deadline, not an absent one', () => {
  const deadline = ScheduleClock.deadlineFor({ window: NOW, max_delay_ms: 0 });
  assert.deepEqual(deadline, NOW);
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
