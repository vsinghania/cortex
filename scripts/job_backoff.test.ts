import assert from 'node:assert/strict';
import test from 'node:test';
import { JobBackoff } from '../src/jobs_svc/worker/job_backoff.js';
import type { RetryPolicy } from '../src/jobs_svc/types/job.types.js';

const POLICY: RetryPolicy = {
  max_attempts: 5,
  base_delay_ms: 1000,
  max_delay_ms: 60_000,
  jitter: 'none'
};

test('doubles per attempt, starting at base_delay_ms', () => {
  const delays = [1, 2, 3, 4].map((attempt) =>
    JobBackoff.nextDelayMs({ attempt, policy: POLICY })
  );
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
});

test('caps at max_delay_ms', () => {
  const delay = JobBackoff.nextDelayMs({ attempt: 20, policy: POLICY });
  assert.equal(delay, POLICY.max_delay_ms);
});

test('attempt 0 is treated as the first attempt', () => {
  assert.equal(JobBackoff.nextDelayMs({ attempt: 0, policy: POLICY }), 1000);
});

test('full jitter spans [0, capped]', () => {
  const jittered: RetryPolicy = { ...POLICY, jitter: 'full' };

  const floor = JobBackoff.nextDelayMs({ attempt: 3, policy: jittered, random: () => 0 });
  const ceiling = JobBackoff.nextDelayMs({ attempt: 3, policy: jittered, random: () => 1 });
  const midpoint = JobBackoff.nextDelayMs({ attempt: 3, policy: jittered, random: () => 0.5 });

  assert.equal(floor, 0);
  assert.equal(ceiling, 4000);
  assert.equal(midpoint, 2000);
});

test('jitter respects the cap too', () => {
  const jittered: RetryPolicy = { ...POLICY, jitter: 'full' };
  const ceiling = JobBackoff.nextDelayMs({ attempt: 20, policy: jittered, random: () => 1 });
  assert.equal(ceiling, POLICY.max_delay_ms);
});

test('nextRunAt offsets from the injected clock', () => {
  const now = new Date('2026-09-09T12:00:00.000Z');
  const run_at = JobBackoff.nextRunAt({ attempt: 2, policy: POLICY, now });
  assert.equal(run_at.toISOString(), '2026-09-09T12:00:02.000Z');
});
