import assert from 'node:assert/strict';
import test from 'node:test';
import { JobRetryDecision } from '../src/jobs_svc/worker/job_retry_decision.js';
import { PermanentJobError } from '../src/jobs_svc/job_errors.js';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../src/common/errors.js';
import type { RetryPolicy } from '../src/jobs_svc/types/job.types.js';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const POLICY: RetryPolicy = {
  max_attempts: 3,
  base_delay_ms: 1000,
  max_delay_ms: 60_000,
  jitter: 'none'
};

const decide = (over: Partial<Parameters<typeof JobRetryDecision.decide>[0]>) =>
  JobRetryDecision.decide({
    attempts: 1,
    max_attempts: POLICY.max_attempts,
    policy: POLICY,
    now: NOW,
    ...over
  });

test('retries a transient failure with backoff', () => {
  const decision = decide({ err: new Error('socket hang up') });
  assert.equal(decision.outcome, 'retry');
  if (decision.outcome !== 'retry') return;
  assert.equal(decision.delay_ms, 1000);
  assert.equal(decision.run_at.toISOString(), '2026-09-09T12:00:01.000Z');
});

test('fails permanently on PermanentJobError, even on attempt 1', () => {
  const decision = decide({ attempts: 1, err: new PermanentJobError('bad payload') });
  assert.deepEqual(decision, { outcome: 'fail', reason: 'permanent_error' });
});

test('a 4xx is permanent, a 5xx is retryable', () => {
  assert.equal(decide({ err: new NotFoundError('gone') }).outcome, 'fail');
  assert.equal(decide({ err: new BadRequestError('nope') }).outcome, 'fail');
  assert.equal(decide({ err: new ServiceUnavailableError('later') }).outcome, 'retry');
});

test('exhausts at the boundary, since attempts counts the failed attempt', () => {
  // attempts is incremented at claim, so attempts === max_attempts is spent.
  assert.equal(decide({ attempts: 2, err: new Error('x') }).outcome, 'retry');
  assert.deepEqual(decide({ attempts: 3, err: new Error('x') }), {
    outcome: 'fail',
    reason: 'attempts_exhausted'
  });
});

test('explicit_retryable false overrides a retryable error type', () => {
  const decision = decide({ err: new Error('transient-looking'), explicit_retryable: false });
  assert.deepEqual(decision, { outcome: 'fail', reason: 'permanent_error' });
});

test('explicit_retryable true overrides a permanent error type', () => {
  const decision = decide({ err: new NotFoundError('gone'), explicit_retryable: true });
  assert.equal(decision.outcome, 'retry');
});

test('an unrecognized throw fails open to retryable', () => {
  assert.equal(decide({ err: 'a bare string' }).outcome, 'retry');
  assert.equal(decide({ err: undefined }).outcome, 'retry');
});
