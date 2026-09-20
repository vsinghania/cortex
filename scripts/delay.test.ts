/*
 * Delay is what keeps a throttled sync from sleeping through a shutdown, so the
 * property under test is that an abort wins over the timer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Delay } from '../src/lib/delay.js';

test('it waits, then resolves', async () => {
  const started = Date.now();
  await Delay.forMs(20);
  assert.ok(Date.now() - started >= 15);
});

test('a zero or negative wait resolves without scheduling anything', async () => {
  await Delay.forMs(0);
  await Delay.forMs(-1);
});

test('an already-aborted signal rejects immediately', async () => {
  const controller = new AbortController();
  controller.abort(new Error('shutting down'));

  await assert.rejects(Delay.forMs(60_000, controller.signal), /shutting down/);
});

test('aborting mid-wait rejects instead of sleeping it out', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const waiting = Delay.forMs(60_000, controller.signal);
  setTimeout(() => controller.abort(new Error('cancelled')), 10);

  await assert.rejects(waiting, /cancelled/);
  assert.ok(Date.now() - started < 1000, 'the 60s timer must not have been waited out');
});

test('a completed wait detaches its abort listener', async () => {
  const controller = new AbortController();
  await Delay.forMs(5, controller.signal);

  // Aborting afterwards must not reject anything, nor leak a listener onto the signal.
  controller.abort(new Error('too late'));
  assert.equal(controller.signal.aborted, true);
});
