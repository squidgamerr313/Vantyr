import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureOwnedFrame } from '../src/lib/owned-frame.ts';
import { createOwnedInference, createVisionLease } from '../src/lib/vision-lifecycle.ts';
import { waitForDelay } from '../src/lib/async.ts';
import { assertPoseImageSupport } from '../src/lib/vision-support.ts';
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise(r => setTimeout(r, 0));
test('CPU pose has an explicit image-processing compatibility gate, with probe context cleanup', () => {
  assert.throws(() => assertPoseImageSupport(() => ({ getContext: () => null })), /requires WebGL2/);
  let lost = 0;
  const canvas = { width: 100, height: 100, getContext: () => ({
    getExtension: () => ({ loseContext() { lost++; } }),
  }) };
  assertPoseImageSupport(() => canvas);
  assert.equal(lost, 1); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});

test('both stages see one synchronously owned image and original dimensions/time', async () => {
  const video = { srcObject: {}, readyState: 2, videoWidth: 1280, videoHeight: 720, pixels: 1 };
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage(input) { canvas.pixels = input.pixels; } }) };
  const frame = captureOwnedFrame(video, canvas, 1234);
  const objectPixels = frame.image.pixels;
  await turn(); video.pixels = 2;
  assert.equal(frame.image.pixels, objectPixels);
  assert.equal(frame.frameTimeMs, 1234); assert.equal(frame.width, 1280); assert.equal(frame.height, 720);
  frame.assertSource();
  video.srcObject = {};
  assert.throws(frame.assertSource, /source changed/);
});
test('unsupported capture and unreadable frames fail explicitly; resize invalidates ownership', () => {
  const video = { srcObject: {}, readyState: 2, videoWidth: 100, videoHeight: 100 };
  const canvas = { getContext: () => ({ drawImage() {} }) };
  const frame = captureOwnedFrame(video, canvas, 1);
  video.videoWidth = 200; assert.throws(frame.assertSource, /source changed/);
  assert.throws(() => captureOwnedFrame(video, { getContext: () => null }, 1), /unavailable/);
  video.readyState = 1;
  assert.throws(() => captureOwnedFrame(video, canvas, 1), /decoded camera frames/);
});
test('overload rejects all reentry without any inference queue, then permits a fresh call', async () => {
  const d = defer(); let calls = 0, releases = 0;
  const owner = createOwnedInference({ run: async () => { calls++; await d.promise; return 1; }, release: () => releases++ });
  const first = owner.detect();
  await Promise.all(Array.from({ length: 1000 }, () => assert.rejects(owner.detect(), /already running/)));
  assert.equal(calls, 1);
  d.resolve(); assert.equal(await first, 1);
  assert.equal(await owner.detect(), 1); assert.equal(calls, 2);
  owner.dispose(); owner.dispose(); assert.equal(releases, 1);
});
test('stop during non-cancellable inference withholds late results and defers exactly one release', async () => {
  const d = defer(); let releases = 0, published = 0;
  const owner = createOwnedInference({ run: () => d.promise, release: () => releases++ });
  const attempt = owner.detect().then(() => published++);
  owner.dispose(); owner.dispose(); assert.equal(releases, 0);
  d.resolve('old scene');
  await assert.rejects(attempt, /stopped/);
  assert.equal(published, 0); assert.equal(releases, 1);
  await assert.rejects(owner.detect(), /stopped/);
});
test('failed model call clears busy state and permits disposal without a late release leak', async () => {
  let releases = 0;
  const owner = createOwnedInference({ run: async () => { throw new Error('backend failed'); }, release: () => releases++ });
  await assert.rejects(owner.detect(), /backend failed/);
  owner.dispose(); assert.equal(releases, 1);
});
test('rapid start/stop cancels lease waiters and never overlaps global backend/model resources', async () => {
  const acquire = createVisionLease();
  const first = await acquire(new AbortController().signal);
  const cancelled = new AbortController();
  const stale = acquire(cancelled.signal);
  cancelled.abort();
  await assert.rejects(stale, { name: 'AbortError' });
  let acquired = false;
  const next = acquire(new AbortController().signal).then(release => { acquired = true; return release; });
  await turn(); assert.equal(acquired, false);
  first(); first();
  const release = await next; assert.equal(acquired, true); release();
  for (let i = 0; i < 20; i++) (await acquire(new AbortController().signal))();
});
test('simultaneous waiters recheck ownership instead of sharing the same backend lease', async () => {
  const acquire = createVisionLease(), signal = new AbortController().signal;
  const release = await acquire(signal);
  let active = 0, maximum = 0;
  const work = () => acquire(signal).then(async done => {
    active++; maximum = Math.max(maximum, active); await turn(); active--; done();
  });
  const a = work(), b = work(); release(); await Promise.all([a, b]);
  assert.equal(maximum, 1);
});
test('stop cancels scheduled interval waits rather than retaining old session timers', async () => {
  const controller = new AbortController();
  const delay = waitForDelay(60000, controller.signal);
  controller.abort(); await assert.rejects(delay, { name: 'AbortError' });
  await assert.rejects(waitForDelay(60000, controller.signal), { name: 'AbortError' });
  await waitForDelay(1, new AbortController().signal);
});
