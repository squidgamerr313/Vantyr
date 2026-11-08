import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionClock } from '../src/lib/session-clock.ts';
import { createRequestGate } from '../src/lib/request-gate.ts';
import { waitFor } from '../src/lib/async.ts';
import { createFrameWatchdog } from '../src/lib/frame-watchdog.ts';
test('the first qualifying event is immediate, including a new session within cooldown', () => {
  const c = createSessionClock();
  assert.equal(c.logDue(0, 8), true);
  assert.equal(c.logDue(7999, 8), false);
  assert.equal(c.logDue(8000, 8), true);
  c.reset(8100);
  assert.equal(c.logDue(8100, 8), true);
});
test('UI, chart time origin and FPS windows reset between sessions', () => {
  const c = createSessionClock(1000);
  assert.equal(c.uiDue(1000), true); assert.equal(c.uiDue(1100), false);
  assert.equal(c.pointDue(1000), true); assert.equal(c.pointDue(1499), false);
  assert.equal(c.frame(1000), 1); assert.equal(c.frame(1500), 2); assert.equal(c.frame(2000), 2);
  assert.equal(c.seconds(3000), 2);
  c.reset(3100);
  assert.equal(c.uiDue(3100), true); assert.equal(c.pointDue(3100), true);
  assert.equal(c.frame(3100), 1); assert.equal(c.seconds(3100), 0);
});
test('duplicate snapshot sends are rejected synchronously, before any UI render', () => {
  const gate = createRequestGate(), ticket = gate.begin();
  assert.equal(typeof ticket, 'number'); assert.equal(gate.begin(), null);
  gate.finish(ticket); assert.notEqual(gate.begin(), null);
});
test('a discarded snapshot cannot display results or finish a newer review', () => {
  const gate = createRequestGate(), old = gate.begin();
  gate.invalidate();
  const fresh = gate.begin();
  assert.equal(gate.current(old), false);
  gate.finish(old);
  assert.equal(gate.begin(), null); assert.equal(gate.current(fresh), true);
  gate.finish(fresh); assert.notEqual(gate.begin(), null);
});
test('async cancellation and deadlines settle otherwise never-ending operations', async () => {
  const a = new AbortController();
  const promise = waitFor(new Promise(() => {}), a.signal, 100, 'Fixture');
  a.abort(); await assert.rejects(promise, { name: 'AbortError' });
  await assert.rejects(waitFor(new Promise(() => {}), new AbortController().signal, 5, 'Model loading'), /Model loading timed out/);
});
test('repeated frozen video frames cannot advance risk persistence or inflate inference FPS', () => {
  const watch = createFrameWatchdog(0);
  assert.equal(watch.fresh(true, 0, 0), true);
  assert.equal(watch.fresh(true, 0, 5000), false);
  assert.equal(watch.fresh(true, 0, 14999), false);
  assert.throws(() => watch.fresh(true, 0, 15000), /frames stopped arriving/);
});
test('fresh frames extend the camera deadline; missing and invalid frames do not', () => {
  const watch = createFrameWatchdog(100);
  assert.equal(watch.fresh(false, 0, 200), false);
  assert.equal(watch.fresh(true, NaN, 300), false);
  assert.equal(watch.fresh(true, .1, 1000), true);
  assert.equal(watch.fresh(true, .2, 15000), true);
  assert.equal(watch.fresh(false, .2, 29999), false);
  assert.throws(() => watch.fresh(false, .2, 30000), /Restart the camera/);
});
test('already-cancelled operations also consume a rejected producer safely', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(waitFor(Promise.reject(new Error('late producer')), controller.signal, 10, 'Fixture'), { name: 'AbortError' });
});
