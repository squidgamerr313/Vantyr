import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMonitoringHealth, EVIDENCE_MAX_AGE_MS } from '../src/lib/monitoring-health.ts';
import { createDecodedFrameProbe } from '../src/lib/decoded-frame-probe.ts';
import { beginMonitoredInference } from '../src/lib/monitoring-inference.ts';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { createZoneMonitor } from '../src/lib/zone-monitor.ts';
import { presentCurrentObservation } from '../src/lib/observation-presentation.ts';
import { peopleFrame, person } from './fixtures/people.mjs';

function fixture() {
  const states = []; let invalidations = 0;
  const monitor = createMonitoringHealth({ publish: (s) => states.push(s), invalidate: () => invalidations++ });
  const frame = (time, now, end = now + 10) => {
    monitor.sample(true, time, now);
    const ticket = monitor.beginInference(time, now);
    return monitor.complete(ticket, time * 1000, end);
  };
  monitor.enter('waiting', 0);
  return { monitor, frame, states, invalidations: () => invalidations };
}
test('health distinguishes every lifecycle phase and publishes transitions, not every frame', () => {
  const { monitor, states, frame } = fixture();
  for (const phase of ['stopped', 'simulation', 'requesting', 'loading', 'waiting', 'interrupted', 'error']) {
    monitor.enter(phase, 0);
    assert.equal(monitor.read().phase, phase); assert.ok(monitor.read().reason);
  }
  monitor.enter('waiting', 0);
  assert.ok(frame(0, 0));
  assert.equal(monitor.read().phase, 'fresh');
  const n = states.length;
  for (let t = 100; t <= 1000; t += 100) assert.ok(frame(t / 1000, t));
  assert.equal(states.length, n);
});
test('live orchestration shares one original timestamp even when the media clock advances inside detect', async () => {
  const f = fixture();
  let reads = 0;
  const video = { get currentTime() { return 1 + reads++ * .001; } };
  f.monitor.sample(true, 1, 1000);
  const engine = {
    async detect(v, capturedFrameTimeMs) {
      const laterRead = v.currentTime * 1000;
      assert.notEqual(laterRead, capturedFrameTimeMs, 'the independently read media clock advanced');
      return { detections: [], landmarks: [], latency: 10, frameTimeMs: capturedFrameTimeMs };
    },
  };
  const { ticket, inference } = beginMonitoredInference(engine, video, f.monitor, 1000);
  const result = await inference;
  assert.equal(result.frameTimeMs, 1000, 'never replace the captured timestamp with completion time');
  assert.equal(f.monitor.complete(ticket, result.frameTimeMs, 1010), true);
  assert.equal(f.monitor.read().phase, 'fresh');
  // The same shared-timestamp contract cannot make old inference fresh after an outage.
  f.monitor.sample(true, 1.1, 1100);
  const late = beginMonitoredInference(engine, video, f.monitor, 1100);
  const oldResult = await late.inference;
  f.monitor.sample(true, 4, 4000);
  assert.equal(f.monitor.complete(late.ticket, oldResult.frameTimeMs, 4010), false);
  assert.equal(f.monitor.read().phase, 'stale');
  f.monitor.enter('waiting', 4100);
  f.monitor.sample(true, 4.1, 4100);
  assert.equal(f.monitor.complete(late.ticket, oldResult.frameTimeMs, 4110), false);
});
test('frozen decoded video expires at the bound even if playback/render loops continue', () => {
  const f = fixture(); assert.ok(f.frame(0, 0));
  for (let t = 100; t < EVIDENCE_MAX_AGE_MS; t += 100) f.monitor.sample(true, 0, t);
  assert.equal(f.monitor.check(2499).phase, 'fresh');
  assert.equal(f.monitor.check(2500).phase, 'stale');
  assert.match(f.monitor.read().reason, /Decoded camera frames/);
  assert.equal(f.invalidations(), 1);
  f.monitor.check(10000); assert.equal(f.invalidations(), 1);
});
test('advancing decoded frames cannot hide stalled inference or resurrect a late result', () => {
  const f = fixture(); f.frame(0, 0);
  const ticket = f.monitor.beginInference(.1, 100);
  for (let t = 100; t <= 3000; t += 100) f.monitor.sample(true, t / 1000, t);
  assert.equal(f.monitor.read().phase, 'stale');
  assert.match(f.monitor.read().reason, /inference/);
  assert.equal(f.monitor.complete(ticket, 100, 3000), false);
  assert.equal(f.monitor.read().phase, 'stale');
  assert.ok(f.frame(3.1, 3100)); assert.equal(f.monitor.read().phase, 'fresh');
});
test('a delayed timer cannot allow a resumed frame or completion to erase the outage', () => {
  const f = fixture(); f.frame(0, 0);
  const pending = f.monitor.beginInference(.1, 100);
  f.monitor.sample(true, 3, 3000);
  assert.equal(f.monitor.read().phase, 'stale');
  assert.equal(f.monitor.complete(pending, 100, 3010), false);
  assert.ok(f.frame(3.1, 3100));
});
test('first inference, missing or invalid timestamps and duplicate samples cannot claim health', () => {
  const f = fixture();
  const ticket = f.monitor.beginInference(0, 0);
  assert.equal(f.monitor.complete(ticket, 0, 10), false, 'no decoded evidence');
  f.monitor.sample(true, 0, 20);
  for (const value of [undefined, NaN, Infinity, -1, 1]) assert.equal(f.monitor.complete(ticket, value, 30), false);
  assert.equal(f.monitor.complete(ticket, 0, 40), true);
  assert.equal(f.monitor.complete(ticket, 0, 50), false, 'duplicate inference');
  const slow = fixture(); slow.monitor.sample(true, 0, 0);
  const pending = slow.monitor.beginInference(0, 0);
  slow.monitor.sample(true, 2.4, 2400);
  assert.equal(slow.monitor.complete(pending, 0, 2500), false);
  assert.equal(slow.monitor.read().phase, 'stale');
});
test('stop, facing/source changes, permission denial, disconnect and model failure reject old work', () => {
  for (const phase of ['stopped', 'simulation', 'requesting', 'loading', 'interrupted', 'error']) {
    const f = fixture(); f.monitor.sample(true, 0, 0);
    const old = f.monitor.beginInference(0, 0);
    f.monitor.enter(phase, 100, `Reason for ${phase}`);
    f.monitor.sample(true, 1, 1000);
    assert.equal(f.monitor.complete(old, 0, 1010), false);
    assert.equal(f.monitor.read().phase, phase);
    f.monitor.enter('waiting', 1100);
    assert.equal(f.monitor.complete(old, 0, 1110), false);
    assert.ok(f.frame(1.2, 1200));
  }
});
test('backward media time invalidates continuity and needs a new inference', () => {
  const f = fixture(); f.frame(10, 0);
  const old = f.monitor.beginInference(10.1, 100);
  f.monitor.sample(true, 0, 200);
  assert.equal(f.monitor.read().phase, 'stale');
  assert.equal(f.monitor.complete(old, 10100, 210), false);
  assert.ok(f.frame(.1, 300));
});
test('invalid or unavailable video does not refresh evidence', () => {
  for (const [ready, time] of [[false, 3], [true, NaN], [true, -1], [true, Infinity]]) {
    const f = fixture(); f.frame(0, 0);
    f.monitor.sample(ready, time, 2400);
    assert.equal(f.monitor.check(2500).phase, 'stale');
  }
});
test('fresh empty scenes and objects without poses remain healthy, separately limited in posture', () => {
  for (const frame of [peopleFrame([], { time: 0 }), peopleFrame([person(.3)], { time: 0 })]) {
    frame.landmarks = [];
    const f = fixture(); assert.ok(f.frame(0, 0));
    const risk = createRiskAssessor().assess(frame, 1000, 600, 10);
    assert.equal(f.monitor.read().phase, 'fresh');
    assert.equal(risk.tracking.quality, 'limited');
    assert.match(presentCurrentObservation(risk, 'live').unknown.join(' '), /Missing or ambiguous poses/);
  }
});
test('health invalidation resets risk and zone continuity but cannot edit saved outcomes', () => {
  const risk = createRiskAssessor(), zone = createZoneMonitor(), flags = [];
  const monitor = createMonitoringHealth({ publish() {}, invalidate() { risk.reset(); zone.reset(); } });
  monitor.enter('waiting', 0);
  const config = { id: 'z', name: 'Bench', rect: [0, 0, 1, 1], dwellSec: 4 };
  function tick(t, wall = t) {
    monitor.sample(true, t / 1000, wall);
    const ticket = monitor.beginInference(t / 1000, wall);
    if (!monitor.complete(ticket, t, wall + 1)) return null;
    const a = risk.assess(peopleFrame([person(.3, { angle: 90 })], { time: t }), 1000, 600, wall);
    const result = zone.tick({ zone: config, sessionId: 's', sessionStartedAt: 0, source: 'live', persons: a.tracking.persons, frameTimeMs: t, now: wall });
    flags.push(...result.triggers);
    return a;
  }
  for (const t of [0, 1000, 2000, 3000, 4000]) tick(t);
  assert.equal(flags.length, 1);
  const original = JSON.stringify(flags);
  monitor.check(6500);
  assert.equal(monitor.read().phase, 'stale');
  const a = tick(7000);
  assert.equal(a.score, 0, 'horizontal duration must start over');
  assert.equal(JSON.stringify(flags), original);
  assert.equal(presentCurrentObservation(a, 'live', 'stale').technical, null);
});
test('presented-frame probe ignores playback-clock progress, cancels and discards old-source callbacks', () => {
  let callback, cancelled = 0;
  const video = {
    srcObject: {}, currentTime: 0, readyState: 2, videoWidth: 100, videoHeight: 100,
    requestVideoFrameCallback(fn) { callback = fn; return 1; },
    cancelVideoFrameCallback() { cancelled++; },
  };
  const probe = createDecodedFrameProbe(video);
  assert.ok(Number.isNaN(probe.read()));
  callback(0, { mediaTime: 0 }); assert.equal(probe.read(), 0);
  video.currentTime = 10; assert.equal(probe.read(), 0);
  video.srcObject = {}; assert.ok(Number.isNaN(probe.read()));
  callback(1, { mediaTime: 10 }); assert.ok(Number.isNaN(probe.read()));
  callback(2, { mediaTime: 0 }); assert.equal(probe.read(), 0);
  probe.stop(); assert.equal(cancelled, 1);
});
test('decode-counter fallback requires new frames, not an advancing currentTime', () => {
  let frames = 0, dropped = 0;
  const video = { srcObject: {}, currentTime: 0, readyState: 2, videoWidth: 100, videoHeight: 100,
    getVideoPlaybackQuality: () => ({ totalVideoFrames: frames, droppedVideoFrames: dropped }) };
  const probe = createDecodedFrameProbe(video);
  assert.ok(Number.isNaN(probe.read()));
  frames = 1; assert.equal(probe.read(), 0);
  video.currentTime = 10; assert.equal(probe.read(), 0);
  frames = 2; assert.equal(probe.read(), 10);
  frames = 3; dropped = 1; video.currentTime = 20; assert.equal(probe.read(), 10);
  video.srcObject = null; assert.ok(Number.isNaN(probe.read()));
  probe.stop();
});
test('decode observation age is not refreshed by a delayed polling loop or inference start', () => {
  const f = fixture();
  f.monitor.sample(true, 1, 1000, 100);
  const ticket = f.monitor.beginInference(1, 1000, 100);
  f.monitor.sample(true, 2, 2400, 2300);
  assert.equal(f.monitor.complete(ticket, 1000, 2600), false, 'age is measured from decoded observation');
  assert.equal(f.monitor.read().phase, 'stale');
  const fresh = f.monitor.beginInference(2, 2650, 2300);
  assert.equal(f.monitor.complete(fresh, 2000, 2700), true);
});
test('expired or future decode observations cannot keep a stalled source fresh', () => {
  for (const observed of [-10000, 10001, NaN, Infinity]) {
    const f = fixture();
    f.monitor.sample(true, 1, 1000, observed);
    const ticket = f.monitor.beginInference(1, 1000, observed);
    assert.equal(f.monitor.complete(ticket, 1000, 1010), false);
  }
});
test('orchestration shares the decoded observation age with the engine budget, not just the media timestamp', async () => {
  const f = fixture();
  f.monitor.sample(true, 1, 1000, 100);
  const engine = { async detect(_video, frameTimeMs, evidenceStartedAt) {
    assert.equal(evidenceStartedAt, 100);
    return { detections: [], landmarks: [], latency: 0, frameTimeMs };
  } };
  const { ticket, inference } = beginMonitoredInference(engine, { currentTime: 1 }, f.monitor, 1000, 100);
  assert.equal(ticket.started, 100);
  assert.equal((await inference).frameTimeMs, 1000);
  const future = f.monitor.beginInference(1, 1000, 2000);
  assert.equal(f.monitor.complete(future, 1000, 2100), false, 'a future ticket cannot gain a later freshness budget');
});
test('probe reports browser decode cost and dropped selection work without saving camera data', () => {
  let callback;
  const video = { srcObject: {}, readyState: 2, videoWidth: 10, videoHeight: 10,
    requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() {} };
  const probe = createDecodedFrameProbe(video);
  callback(10, { mediaTime: 1, processingDuration: .02, presentedFrames: 3 });
  probe.admit();
  assert.equal(probe.diagnostics().decodeMs, 20);
  assert.equal(probe.diagnostics().skipped, 2);
  probe.stop(); callback(20, { mediaTime: 2, presentedFrames: 4 });
  assert.ok(Number.isNaN(probe.read()), 'cancelled callbacks cannot resurrect the probe');
});
