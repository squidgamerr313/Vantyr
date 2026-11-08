import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCameraSession } from '../src/lib/camera-session.ts';
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise((r) => setTimeout(r, 0));
function fixture(getUserMedia, config = {}) {
  class Video extends EventTarget {
    srcObject = null; readyState = 1; videoWidth = 1280; videoHeight = 720; plays = 0;
    pause() {} async play() { this.plays++; }
  }
  const video = new Video(), states = [];
  const camera = createCameraSession({ video: () => video, getUserMedia, publish: (s) => states.push(s), permissionTimeoutMs: 100, videoTimeoutMs: 50, ...config });
  return { camera, video, states };
}
function stream() {
  const track = new EventTarget();
  track.stops = 0; track.stop = () => track.stops++;
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
test('start supplies facing preference and no audio, stop releases tracks and clears errors', async () => {
  const s = stream(); let constraints;
  const { camera, video, states } = fixture(async (c) => { constraints = c; return s; });
  assert.equal(await camera.start('environment'), true);
  assert.equal(constraints.video.facingMode.ideal, 'environment'); assert.equal(constraints.audio, false);
  assert.deepEqual(states.at(-1).dims, { w: 1280, h: 720 });
  camera.stop(); assert.equal(s.track.stops, 1); assert.equal(video.srcObject, null);
  assert.deepEqual(states.at(-1), { status: 'idle', error: null, dims: null });
});
test('a permission grant arriving after stop is released and never played', async () => {
  const d = defer(), s = stream();
  const { camera, video, states } = fixture(() => d.promise);
  const start = camera.start('user'); camera.stop(); d.resolve(s);
  assert.equal(await start, false); await turn();
  assert.equal(s.track.stops, 1); assert.equal(video.plays, 0); assert.equal(states.at(-1).status, 'idle');
});
test('stopping while metadata is pending settles start and removes old video listeners', async () => {
  const s = stream();
  const { camera, video } = fixture(async () => s);
  video.readyState = 0;
  const start = camera.start('user'); await turn(); camera.stop();
  assert.equal(await start, false);
  video.dispatchEvent(new Event('loadedmetadata')); await turn();
  assert.equal(video.plays, 0); assert.equal(s.track.stops, 1);
});
test('rapid restarts cannot attach a previous permission grant to the new session', async () => {
  const a = defer(), b = defer(), old = stream(), current = stream(); let calls = 0;
  const { camera, video } = fixture(() => ++calls === 1 ? a.promise : b.promise);
  const first = camera.start('user'), second = camera.start('environment');
  b.resolve(current); assert.equal(await second, true);
  a.resolve(old); assert.equal(await first, false); await turn();
  assert.equal(video.srcObject, current); assert.equal(old.track.stops, 1); assert.equal(current.track.stops, 0);
  camera.stop(false);
});
test('permission denial is actionable and a subsequent stop removes the stale error', async () => {
  const { camera, states } = fixture(async () => { throw new DOMException('Denied', 'NotAllowedError'); });
  assert.equal(await camera.start('user'), false); assert.match(states.at(-1).error, /permission was denied/);
  camera.stop(); assert.equal(states.at(-1).error, null);
});
test('pending permission and video metadata both have deadlines; a late stream is still stopped', async () => {
  const d = defer(), s = stream();
  const { camera, states } = fixture(() => d.promise, { permissionTimeoutMs: 5 });
  assert.equal(await camera.start('user'), false); assert.match(states.at(-1).error, /timed out/);
  d.resolve(s); await turn(); assert.equal(s.track.stops, 1);
  const other = stream(), f = fixture(async () => other, { videoTimeoutMs: 5 });
  f.video.readyState = 0;
  assert.equal(await f.camera.start('user'), false); assert.match(f.states.at(-1).error, /timed out/);
  assert.equal(other.track.stops, 1);
  f.video.dispatchEvent(new Event('loadedmetadata')); assert.equal(f.video.plays, 0);
});
test('disconnected streams clear dimensions and cannot be mistaken for running video', async () => {
  const s = stream(), { camera, video, states } = fixture(async () => s);
  await camera.start('user');
  s.track.dispatchEvent(new Event('ended'));
  assert.equal(states.at(-1).status, 'error'); assert.match(states.at(-1).error, /disconnected/);
  assert.equal(states.at(-1).dims, null); assert.equal(video.srcObject, null);
});
test('late playback completion after stop never republishes a running session', async () => {
  const s = stream(), d = defer(), { camera, video, states } = fixture(async () => s);
  video.play = () => d.promise;
  const start = camera.start('user'); await turn(); camera.stop(); d.resolve();
  assert.equal(await start, false); assert.equal(states.at(-1).status, 'idle');
});
test('muted tracks invalidate the camera and detached listeners cannot interrupt a restart', async () => {
  const old = stream(), next = stream(); let calls = 0;
  const { camera, video, states } = fixture(async () => ++calls === 1 ? old : next);
  assert.equal(await camera.start('user'), true);
  old.track.dispatchEvent(new Event('mute'));
  assert.equal(states.at(-1).status, 'error'); assert.match(states.at(-1).error, /interrupted/);
  assert.equal(video.srcObject, null); assert.equal(old.track.stops, 1);
  assert.equal(await camera.start('environment'), true);
  old.track.dispatchEvent(new Event('mute')); old.track.dispatchEvent(new Event('ended'));
  assert.equal(states.at(-1).status, 'running'); assert.equal(video.srcObject, next);
  camera.stop();
});
test('a track already ended or muted during startup cannot publish running', async () => {
  for (const state of [{ readyState: 'ended' }, { muted: true }]) {
    const s = stream(); Object.assign(s.track, state);
    const { camera, states } = fixture(async () => s);
    assert.equal(await camera.start('user'), false);
    assert.equal(states.at(-1).status, 'error');
    assert.equal(states.some((s) => s.status === 'running'), false);
  }
});
