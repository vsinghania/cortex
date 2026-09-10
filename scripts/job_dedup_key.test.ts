import assert from 'node:assert/strict';
import test from 'node:test';
import { JobDedupKey } from '../src/jobs_svc/job_dedup_key.js';

test('joins parts with a separator', () => {
  assert.equal(JobDedupKey.build(['notes_reindex', 'user-xyz']), 'notes_reindex:user-xyz');
});

test('is stable for the same input', () => {
  assert.equal(JobDedupKey.build(['a', 'b']), JobDedupKey.build(['a', 'b']));
});

test('trims parts', () => {
  assert.equal(JobDedupKey.build([' a ', ' b ']), 'a:b');
});

test('an empty part cannot collide with the shorter key', () => {
  assert.throws(() => JobDedupKey.build(['notes_reindex', '']), /non-empty/);
  assert.throws(() => JobDedupKey.build(['notes_reindex', '   ']), /non-empty/);
  assert.equal(JobDedupKey.build(['notes_reindex']), 'notes_reindex');
});

test('rejects no parts at all', () => {
  assert.throws(() => JobDedupKey.build([]), /non-empty/);
});

test('rejects a separator inside a part, which would let two inputs collide', () => {
  // build(['a:b', 'c']) and build(['a', 'b:c']) would both yield 'a:b:c'.
  assert.throws(() => JobDedupKey.build(['a:b', 'c']), /must not contain/);
});
