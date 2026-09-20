/*
 * The throttling rules, which are pure so they can be tested without a network. Graph
 * throttles the OneNote API readily, and these decide how long one call waits before the
 * job queue takes over.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphRetryPolicy } from '../src/onenote_svc/adapters/graph_retry_policy.js';

const FIRST = { attempt: 1, waited_ms: 0 };

test('Retry-After in seconds is obeyed exactly', () => {
  const decision = GraphRetryPolicy.decide({ status: 429, retry_after_header: '7', ...FIRST });
  assert.deepEqual(decision, { outcome: 'retry', delay_ms: 7000 });
});

test('Retry-After as an HTTP date is honoured too', () => {
  const at = new Date(Date.now() + 5000).toUTCString();
  const decision = GraphRetryPolicy.decide({ status: 429, retry_after_header: at, ...FIRST });

  assert.equal(decision.outcome, 'retry');
  // Whole-second resolution in the header, so allow a little slack either way.
  assert.ok(decision.outcome === 'retry' && decision.delay_ms > 3500 && decision.delay_ms <= 5000);
});

test('without a Retry-After the backoff grows with each attempt', () => {
  const first = GraphRetryPolicy.decide({ status: 503, attempt: 1, waited_ms: 0 });
  const second = GraphRetryPolicy.decide({ status: 503, attempt: 2, waited_ms: 2000 });

  assert.deepEqual(first, { outcome: 'retry', delay_ms: 2000 });
  assert.deepEqual(second, { outcome: 'retry', delay_ms: 4000 });
});

test('one sleep is capped, however long the provider asks for', () => {
  const decision = GraphRetryPolicy.decide({ status: 429, retry_after_header: '3600', ...FIRST });
  assert.deepEqual(decision, { outcome: 'retry', delay_ms: 60_000 });
});

test('a wait that would blow the per-call budget is handed back to the queue', () => {
  const decision = GraphRetryPolicy.decide({ status: 429, retry_after_header: '60', attempt: 2, waited_ms: 110_000 });
  assert.deepEqual(decision, { outcome: 'give_up' }, 'retryable, but not while holding a worker slot');
});

test('retries stop after a bounded number of attempts', () => {
  const decision = GraphRetryPolicy.decide({ status: 429, retry_after_header: '1', attempt: 4, waited_ms: 3000 });
  assert.deepEqual(decision, { outcome: 'give_up' });
});

test('throttling and server errors retry; a bad request never does', () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(GraphRetryPolicy.decide({ status, ...FIRST }).outcome, 'retry', String(status));
  }
  for (const status of [400, 401, 403, 404, 410]) {
    assert.equal(GraphRetryPolicy.decide({ status, ...FIRST }).outcome, 'permanent', String(status));
  }
});

test('a malformed Retry-After falls back to the backoff rather than throwing', () => {
  const decision = GraphRetryPolicy.decide({ status: 429, retry_after_header: 'soon-ish', ...FIRST });
  assert.deepEqual(decision, { outcome: 'retry', delay_ms: 2000 });
});
