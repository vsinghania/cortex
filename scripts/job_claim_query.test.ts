import assert from 'node:assert/strict';
import test from 'node:test';
import { JobClaimQuery } from '../src/jobs_svc/repositories/job_claim_query.js';
import { JobStatus } from '../src/jobs_svc/types/job.types.js';
import { Time } from '../src/lib/time.js';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const LEASE_MS = Time.minutesToMs(2);
const built = () => JobClaimQuery.build({ worker_id: 'ctr-1:7:abc123', lease_ms: LEASE_MS, now: NOW });

test('the filter carries exactly status and visible_at', () => {
  // Guards against a routing field creeping back in without an index to serve it.
  assert.deepEqual(Object.keys(built().filter).sort(), ['status', 'visible_at']);
});

test('claims queued jobs and reclaims expired running leases in one predicate', () => {
  const { filter } = built();
  assert.deepEqual(filter.status, { $in: [JobStatus.Queued, JobStatus.Running] });
  assert.deepEqual(filter.visible_at, { $lte: NOW });
});

test('sort matches the job_claim key order so no blocking SORT is planned', () => {
  assert.deepEqual(built().options.sort, { visible_at: 1 });
});

test('returns the post-update document', () => {
  assert.equal(built().options.returnDocument, 'after');
});

test('takes the lease and hides the job for lease_ms', () => {
  const set = built().update[0].$set as Record<string, unknown>;
  const lease_until = new Date(NOW.getTime() + LEASE_MS);

  assert.equal(set.status, JobStatus.Running);
  assert.equal(set.locked_by, 'ctr-1:7:abc123');
  assert.deepEqual(set.locked_at, NOW);
  assert.deepEqual(set.lease_expires_at, lease_until);
  // visible_at mirrors the lease, which is what makes reclaim the claim.
  assert.deepEqual(set.visible_at, lease_until);
});

test('increments attempts at claim time', () => {
  const set = built().update[0].$set as Record<string, unknown>;
  assert.deepEqual(set.attempts, { $add: ['$attempts', 1] });
});

test('bumps reclaimed_count only when the job was already running', () => {
  const set = built().update[0].$set as Record<string, unknown>;
  assert.deepEqual(set.reclaimed_count, {
    $cond: [
      { $eq: ['$status', JobStatus.Running] },
      { $add: ['$reclaimed_count', 1] },
      '$reclaimed_count'
    ]
  });
});

test('started_at records the first claim and survives reclaims', () => {
  const set = built().update[0].$set as Record<string, unknown>;
  assert.deepEqual(set.started_at, { $ifNull: ['$started_at', NOW] });
});

test('sets updated_at explicitly, since pipeline updates bypass Mongoose timestamps', () => {
  const set = built().update[0].$set as Record<string, unknown>;
  assert.deepEqual(set.updated_at, NOW);
});

test('is a pipeline update, which $cond and $ifNull require', () => {
  assert.ok(Array.isArray(built().update));
});
