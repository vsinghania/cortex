import assert from 'node:assert/strict';
import test from 'node:test';
import { JobLease } from '../src/jobs_svc/worker/job_lease.js';
import { Time } from '../src/lib/time.js';

const NOW = new Date('2026-09-09T12:00:00.000Z');

test('expiryAt offsets from the injected clock', () => {
  const expiry = JobLease.expiryAt({ now: NOW, lease_ms: Time.minutesToMs(2) });
  assert.equal(expiry.toISOString(), '2026-09-09T12:02:00.000Z');
});

test('the expiry boundary is inclusive, matching the claim filter $lte', () => {
  assert.equal(JobLease.isExpired({ visible_at: NOW, now: NOW }), true);
});

test('a future visible_at is not expired', () => {
  const future = new Date(NOW.getTime() + 1);
  assert.equal(JobLease.isExpired({ visible_at: future, now: NOW }), false);
});

test('a past visible_at is expired', () => {
  const past = new Date(NOW.getTime() - 1);
  assert.equal(JobLease.isExpired({ visible_at: past, now: NOW }), true);
});

test('a terminal job (null visible_at) is never expired', () => {
  assert.equal(JobLease.isExpired({ visible_at: null, now: NOW }), false);
});

test('heartbeat is lease/3 when that is under the progress flush interval', () => {
  assert.equal(JobLease.heartbeatIntervalMs(Time.secondsToMs(15)), 5000);
});

test('heartbeat is capped by the progress flush interval on long leases', () => {
  // lease/3 would be 100s at a 5-minute lease, which would freeze the polling UI.
  assert.equal(JobLease.heartbeatIntervalMs(Time.minutesToMs(5)), 10_000);
});

test('heartbeat never returns zero', () => {
  assert.ok(JobLease.heartbeatIntervalMs(1) >= 1);
});
