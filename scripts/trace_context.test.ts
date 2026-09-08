import assert from 'node:assert/strict';
import test from 'node:test';
import { TraceContext } from '../src/common/trace_context.js';

test('run() keeps concurrent stores isolated', async () => {
  const seen: Array<string | undefined> = [];

  const observe = async (delay_ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, delay_ms));
    seen.push(TraceContext.getUserId());
    return TraceContext.getTraceId();
  };

  const [first, second] = await Promise.all([
    TraceContext.run({ trace_id: 'trace-a', user_id: 'user-a' }, () => observe(20)),
    TraceContext.run({ trace_id: 'trace-b', user_id: 'user-b' }, () => observe(5))
  ]);

  assert.equal(first, 'trace-a');
  assert.equal(second, 'trace-b');
  assert.deepEqual(seen, ['user-b', 'user-a']);
});

test('run() does not leak into the caller after it resolves', async () => {
  await TraceContext.run({ trace_id: 'trace-inner', user_id: 'user-inner' }, async () => {
    assert.equal(TraceContext.getTraceId(), 'trace-inner');
  });

  assert.equal(TraceContext.getTraceId(), undefined);
});

test('run() restores the outer store when nested', async () => {
  await TraceContext.run({ trace_id: 'outer' }, async () => {
    await TraceContext.run({ trace_id: 'inner' }, async () => {
      assert.equal(TraceContext.getTraceId(), 'inner');
    });
    assert.equal(TraceContext.getTraceId(), 'outer');
  });
});

test('run() propagates a rejection without leaving its store behind', async () => {
  await assert.rejects(
    TraceContext.run({ trace_id: 'trace-boom' }, async () => {
      throw new Error('boom');
    }),
    /boom/
  );

  assert.equal(TraceContext.getTraceId(), undefined);
});
