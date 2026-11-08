import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSharpObjectEvidence, SHARP_OBJECT_POLICY } from '../src/lib/sharp-object-evidence.ts';
import { createPersonTracker } from '../src/lib/person-tracking.ts';
import { createRiskAssessor } from '../src/lib/risk.ts';

const tool = (label = 'knife', x = 240, y = 260, w = 40, h = 20, confidence = .9) =>
  ({ id: 'unstable-index', label, confidence, box: [x, y, w, h] });
const p = (id = 'p1', x = .15, status = 'tracked') => ({
  id, label: id, box: [x, .1, .2, .7], status, detectionIndex: 0, poseIndex: null,
  posture: 'unavailable', horizontalMs: 0, observedMs: 0, observations: [], limitations: [],
});
const summary = (persons = [p()]) => ({ persons, quality: 'limited', limitations: [] });
const frame = (time, detections = [tool()], sceneMotion) =>
  ({ detections, landmarks: [], latency: 0, frameTimeMs: time, sceneMotion });
const run = (engine, time, objects, people, source = 'camera-a', scene) =>
  engine.update(frame(time, objects, scene), summary(people), 1000, 600, { source, session: 's1' });
test('fixed elapsed-time and sample thresholds describe ordinary tools, not alerts', () => {
  for (const label of ['knife', 'scissors']) {
    const e = createSharpObjectEvidence();
    for (let i = 0; i <= 8; i++) {
      const r = run(e, i * 125, [tool(label)]);
      assert.equal(r.observations[0].persistentObservation, i >= 4);
      assert.equal(r.observations[0].confidence, .9);
      assert.equal(r.observations[0].visibility, 'unknown');
      assert.equal(r.observations[0].association.status, 'image-proximity');
      assert.equal(r.eligibility.liveIntegration, false);
      assert.equal(r.eligibility.strongerAlerts, false);
      assert.ok(!('score' in r));
    }
  }
  const sparse = createSharpObjectEvidence();
  run(sparse, 0); assert.equal(run(sparse, 500).observations[0].persistentObservation, false);
});
test('empty and visually similar utensils are negative controls, not new classes', () => {
  const e = createSharpObjectEvidence();
  for (const detections of [[], [tool('spoon')], [tool('fork')], [tool('toothbrush')]]) {
    assert.deepEqual(run(e, 0, detections).observations, []);
    assert.equal(e.stats().tracks, 0);
  }
});
test('loss, low confidence, tiny or clipped observations break rather than bridge persistence', () => {
  for (const lost of [[], [tool('knife', 240, 260, 40, 20, .3)], [tool('knife', 240, 260, 8, 8)], [tool('knife', 0)]]) {
    const e = createSharpObjectEvidence();
    for (let i = 0; i < 5; i++) run(e, i * 125);
    const interrupted = run(e, 625, lost);
    assert.ok(interrupted.observations.every(o => !o.persistentObservation));
    assert.equal(run(e, 750).observations[0].observedMs, 0);
  }
});
test('blur and occlusion are not inferred from score; independent annotation remains required', () => {
  const r = run(createSharpObjectEvidence(), 0);
  assert.match(r.limitations.join(' '), /blur and occlusion are unknown/);
  assert.equal(r.observations[0].visibility, 'unknown');
});
test('multiple people, overlapping people and objects make association uncertain', () => {
  for (const people of [[p(), p('p2', .3)], [p(null, .15, 'uncertain')], [p(), p('p2', .16)]]) {
    const e = createSharpObjectEvidence();
    const r = run(e, 0, [tool()], people);
    assert.equal(r.observations[0].association.status, 'uncertain');
    assert.equal(r.observations[0].id, null);
  }
  const e = createSharpObjectEvidence();
  const r = run(e, 0, [tool(), tool('scissors', 280)]);
  assert.ok(r.observations.every(o => o.association.status === 'uncertain' && !o.persistentObservation));
});
test('object crossings discard continuity, and detector array IDs/order are not identities', () => {
  const e = createSharpObjectEvidence();
  const objects = [tool('knife', 100), tool('scissors', 800)];
  const a = run(e, 0, objects, []);
  const b = run(e, 125, [...objects].reverse(), []);
  assert.deepEqual(b.observations.map(o => o.id), a.observations.map(o => o.id).reverse());
  const cross = run(e, 250, [tool(), tool('knife', 245)], []);
  assert.ok(cross.observations.every(o => o.matching === 'ambiguous' && o.id === null));
  assert.equal(run(e, 375, [tool()], []).observations[0].observedMs, 0);
});
test('person replacement, loss, uncertainty and source changes cannot inherit object time', () => {
  for (const people of [[], [p('p2')], [p(null, .15, 'uncertain')]]) {
    const e = createSharpObjectEvidence();
    for (let i = 0; i < 5; i++) run(e, i * 125);
    assert.equal(run(e, 625, undefined, people).observations[0].observedMs, 0);
    assert.equal(run(e, 750).observations[0].observedMs, 0);
  }
  const e = createSharpObjectEvidence();
  run(e, 0); run(e, 125);
  assert.equal(run(e, 250, undefined, undefined, 'camera-b').observations[0].observedMs, 0);
});
test('reverse, repeated, missing, nonfinite and gapped timestamps invalidate history', () => {
  for (const time of [0, -1, 500, NaN, undefined]) {
    const e = createSharpObjectEvidence();
    run(e, 0); run(e, 125);
    const r = e.update(frame(time), summary(), 1000, 600, { source: 'camera-a', session: 's1' });
    assert.ok(r.observations.every(o => o.observedMs === 0));
    assert.equal(run(e, 1000).observations[0].observedMs, 0);
  }
});
test('scene motion moving or unknown withholds and restarts; input tracker is immutable', () => {
  for (const status of ['moving', 'unknown']) {
    const e = createSharpObjectEvidence(), tracking = summary();
    const saved = structuredClone(tracking);
    run(e, 0); run(e, 125);
    const r = e.update(frame(250, undefined, { status, reason: 'control', support: 10 }), tracking, 1000, 600, { source: 'camera-a', session: 's1' });
    assert.equal(r.observations[0].id, null);
    assert.deepEqual(tracking, saved);
    assert.equal(run(e, 375).observations[0].observedMs, 0);
  }
});
test('resolution/aspect changes, invalid input, bounded state and explicit reset', () => {
  const e = createSharpObjectEvidence();
  for (let i = 0; i < 1000; i++) run(e, i * 125, Array.from({ length: 100 }, (_, j) => tool('knife', j * 10)), []);
  assert.ok(e.stats().tracks <= SHARP_OBJECT_POLICY.maxObjects);
  e.reset();
  assert.equal(e.stats().tracks, 0);
  assert.equal(run(e, 0).observations[0].id, 'o1');
  assert.equal(e.update(frame(125), summary(), 600, 1000, { source: 'camera-a', session: 's1' }).observations[0].observedMs, 0);
  assert.equal(e.update(frame(250), summary(), 0, 600, { source: 'camera-a', session: 's1' }).status, 'unavailable');
  assert.equal(run(e, 375, [tool('knife', 240, 260, 40, 20, NaN)]).observations.length, 0);
});
test('real tracker output is consumed without changing tracker ownership or live baseline score', () => {
  const tracker = createPersonTracker(), e = createSharpObjectEvidence(), baseline = createRiskAssessor();
  const f = frame(0, [{ ...tool('person', 150, 60, 200, 420) }, tool()]);
  const tracking = tracker.update(f, 1000, 600, 0), snapshot = structuredClone(tracking);
  const r = e.update(f, tracking, 1000, 600, { source: 'camera-a', session: 's1' });
  assert.equal(r.observations[0].association.personId, tracking.persons[0].id);
  assert.deepEqual(tracking, snapshot);
  assert.equal(baseline.assess(f, 1000, 600, 0).score, 48);
});
test('session boundaries and freshly reset tracker IDs cannot reuse an old object clock', () => {
  const e = createSharpObjectEvidence();
  for (let i = 0; i < 5; i++) run(e, i * 125);
  assert.equal(run(e, 625, undefined, [p('p1', .15, 'new')]).observations[0].observedMs, 0);
  assert.equal(e.update(frame(750), summary(), 1000,600, { source: 'camera-a', session: 's2' }).observations[0].observedMs, 0);
  assert.equal(e.update(frame(875), summary(), 1000,600, { source: 'camera-a', session: '' }).status, 'unavailable');
});
