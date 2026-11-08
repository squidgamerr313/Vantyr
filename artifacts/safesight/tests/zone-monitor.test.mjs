import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoneMonitor, validZone, validRect, imagePoint, rectangle } from '../src/lib/zone-monitor.ts';
import { simulateZoneFrame, simulateDemoFrame, DEMO_ZONE } from '../src/lib/zone-demo.ts';
import { simulateFrame } from '../src/lib/overlay.ts';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { peopleFrame, person } from './fixtures/people.mjs';
const zone = { id: 'zone-a', name: 'Bench A', rect: [.1, .5, .3, .3], dwellSec: 4 };
const tracked = (id = 'p1', x = .25, extra = {}) => ({
  id, label: `Person ${id?.slice(1) ?? '?'}`, box: [x - .05, .2, .1, .5], detectionIndex: 0, poseIndex: null,
  status: 'missing-pose', posture: 'unavailable', horizontalMs: 0, observedMs: 0, observations: [], limitations: [], ...extra,
});
test('ordinary Simulation preserves the original scene, two poses and risk assessment rather than choosing a zone script', () => {
  const originalRisk = createRiskAssessor(), ordinaryRisk = createRiskAssessor();
  for (const t of [0, 120, 1000, 2000, 5000, 6000, 12000]) {
    const original = simulateFrame(t), ordinary = simulateDemoFrame(t);
    assert.deepEqual(ordinary, original);
    assert.equal(ordinary.landmarks.length, 2);
    assert.deepEqual(ordinary.detections.map((d) => d.label), ['person', 'person', 'ladder']);
    assert.deepEqual(ordinaryRisk.assess(ordinary, 1536, 864, t, { source: 'demo' }), originalRisk.assess(original, 1536, 864, t, { source: 'demo' }));
  }
});
test('only explicit zone selections use scripted boxes, with their own fresh replay origin', () => {
  for (const scenario of ['brief', 'sustained']) {
    assert.deepEqual(simulateDemoFrame(8500, scenario, 8000), simulateZoneFrame(500, scenario));
    assert.equal(simulateDemoFrame(8500, scenario, 8000).landmarks.length, 0);
  }
  assert.deepEqual(simulateDemoFrame(8500, 'scene', 8000), simulateFrame(8500));
});
function fixture(z = zone) {
  const engine = createZoneMonitor();
  const tick = (t, persons = [tracked()], extra = {}) => engine.tick({
    zone: z, sessionId: 'session-a', sessionStartedAt: 1000, source: 'live', persons, frameTimeMs: t, now: t, ...extra,
  });
  return { engine, tick };
}
test('zone geometry validation rejects tiny, out-of-image, nonfinite and malformed rectangles', () => {
  assert.ok(validZone(zone)); assert.ok(validRect([0, 0, 1, 1]));
  for (const rect of [[0, 0, .01, .3], [.8, 0, .3, .4], [NaN, 0, 1, 1], [0, 0, 1], [-.1, 0, .2, .2]]) assert.equal(validRect(rect), false);
  for (const dwellSec of [0, 61, 1.5, NaN]) assert.equal(validZone({ ...zone, dwellSec }), false);
  assert.equal(validZone({ ...zone, name: ' ' }), false);
});
test('pointer coordinates map to contained video, excluding letterbox padding and offsets', () => {
  const b = { left: 25, top: 35, width: 400, height: 300 };
  assert.deepEqual(imagePoint(225, 185, b, 1600, 800), [.5, .5]);
  assert.equal(imagePoint(225, 40, b, 1600, 800), null);
  assert.deepEqual(imagePoint(225, 185, b, 900, 1600), [.5, .5]);
  assert.equal(imagePoint(30, 185, b, 900, 1600), null);
  assert.equal(imagePoint(0, 0, b, 0, 0), null);
  const rect = rectangle([.8, .9], [.2, .3]);
  assert.ok(Math.abs(rect[2] - .6) < 1e-9); assert.ok(Math.abs(rect[3] - .6) < 1e-9);
});
test('bottom-center, not arbitrary bbox overlap, determines zone membership', () => {
  const { tick } = fixture();
  assert.equal(tick(0, [tracked('p1', .45)]).occupants.length, 0);
  assert.equal(tick(100, [tracked('p1', .25)]).occupants.length, 1);
});
test('a reliable person without pose landmarks triggers once after the configured duration', () => {
  const { tick } = fixture();
  for (const t of [0, 1000, 2000, 3000]) assert.equal(tick(t).triggers.length, 0);
  const result = tick(4000);
  assert.equal(result.triggers.length, 1); assert.equal(result.triggers[0].dwellMs, 4000);
  assert.equal(result.triggers[0].personId, 'p1');
  for (const t of [5000, 6000, 7000, 8000]) assert.equal(tick(t).triggers.length, 0);
});
test('different people have independent dwell clocks and cannot inherit an earlier entry', () => {
  const { tick } = fixture();
  tick(0, [tracked(), tracked('p2', .7)]);
  tick(1000, [tracked(), tracked('p2', .7)]);
  tick(2000, [tracked(), tracked('p2', .3)]);
  tick(3000, [tracked(), tracked('p2', .3)]);
  assert.deepEqual(tick(4000, [tracked(), tracked('p2', .3)]).triggers.map((r) => r.personId), ['p1']);
  tick(5000, [tracked(), tracked('p2', .3)]);
  assert.deepEqual(tick(6000, [tracked(), tracked('p2', .3)]).triggers.map((r) => r.personId), ['p2']);
});
test('brief exits reset duration, but a confirmed exit permits a later occupancy episode', () => {
  const { tick } = fixture();
  tick(0); tick(1000); tick(2000, [tracked('p1', .8)]); tick(3000);
  assert.equal(tick(4000).triggers.length, 0);
  tick(5000); tick(6000);
  const first = tick(7000).triggers[0];
  tick(8000, [tracked('p1', .8)]);
  tick(9000); tick(10000); tick(11000); tick(12000);
  const second = tick(13000).triggers[0];
  assert.ok(first); assert.ok(second); assert.notEqual(first.episodeId, second.episodeId);
});
test('boundary jitter breaks pre-trigger continuity and cannot repeatedly re-arm a fired episode', () => {
  const { tick } = fixture();
  tick(0); tick(1000);
  assert.equal(tick(2000, [tracked('p1', .102)]).occupants[0].state, 'boundary');
  tick(3000); tick(4000); tick(5000);
  assert.equal(tick(6000).triggers.length, 0);
  assert.equal(tick(7000).triggers.length, 1);
  tick(8000, [tracked('p1', .098)]);
  for (const t of [9000, 10000, 11000, 12000, 13000]) assert.equal(tick(t).triggers.length, 0);
});
test('crossing ambiguity, person loss and unusable boxes cannot carry a duration', () => {
  for (const affected of [[], [tracked(null)], [tracked('p1', .25, { status: 'uncertain' })], [tracked('p1', .25, { box: [0, 0, 1, NaN] })]]) {
    const { tick } = fixture(); tick(0); tick(1000); tick(2000, affected);
    tick(3000);
    assert.equal(tick(4000).triggers.length, 0);
  }
});
test('a pose-derived box without an object detection does not assert image-zone presence', () => {
  const { tick } = fixture();
  for (let t = 0; t <= 5000; t += 1000) {
    const result = tick(t, [tracked('p1', .25, { detectionIndex: null })]);
    assert.equal(result.triggers.length, 0); assert.equal(result.status, 'uncertain');
  }
});
test('duplicate decoded frames never advance time or repeat a trigger; wall staleness resets it', () => {
  const { tick } = fixture(); tick(0);
  assert.equal(tick(0, [tracked()], { now: 2400 }).occupants[0].dwellMs, 0);
  assert.equal(tick(0, [tracked()], { now: 2600 }).status, 'stale');
  tick(1000, [tracked()], { now: 2700 });
  tick(2000, [tracked()], { now: 3700 });
  tick(3000, [tracked()], { now: 4700 });
  assert.equal(tick(4000, [tracked()], { now: 5700 }).triggers.length, 0);
  assert.equal(tick(5000, [tracked()], { now: 6700 }).triggers.length, 1);
  assert.equal(tick(5000, [tracked()], { now: 6800 }).triggers.length, 0);
});
test('missing/nonfinite timestamps and long/backwards frame gaps invalidate durations', () => {
  for (const extra of [{ frameTimeMs: undefined }, { frameTimeMs: NaN }, { frameTimeMs: -1 }, { frameTimeMs: 10000 }, { frameTimeMs: 500 }]) {
    const { tick } = fixture(); tick(0); tick(1000); tick(2000, [tracked()], extra);
    tick(3000);
    assert.equal(tick(4000).triggers.length, 0);
  }
});
test('source, session, configuration edits, removal and explicit reset each clear the rule state', () => {
  for (const extra of [{ source: 'demo' }, { sessionId: 'session-b' }, { zone: { ...zone, name: 'Other zone' } }, { zone: null }]) {
    const { tick } = fixture(); tick(0); tick(1000); tick(2000); tick(3000, [tracked()], extra);
    assert.equal(tick(4000, [tracked()], extra).triggers.length, 0);
  }
  const { engine, tick } = fixture(); tick(0); tick(1000); engine.reset();
  assert.equal(tick(4000).triggers.length, 0);
});
test('normalized tracking survives uniform scaling without transferring dwell to different people', () => {
  const { tick } = fixture();
  const risk = createRiskAssessor();
  for (let t = 0; t <= 4000; t += 1000) {
    const width = t >= 2000 ? 2000 : 1000, height = width * .6;
    const a = risk.assess(peopleFrame([person(.25)], { width, height, time: t }), width, height, t);
    const result = tick(t, a.tracking.persons);
    assert.equal(result.triggers.length, t === 4000 ? 1 : 0);
  }
});
for (const [scenario, expected] of [['brief', 0], ['sustained', 1]]) {
  test(`scripted ${scenario} uses the real tracking/zone path and creates ${expected} zone flags, no scored hazard`, () => {
    const risk = createRiskAssessor(), gate = createZoneMonitor();
    const outputs = [];
    for (let t = 0; t <= 14000; t += 120) {
      const frame = simulateZoneFrame(t, scenario);
      const a = risk.assess(frame, 1536, 864, t, { source: 'demo' });
      assert.equal(a.score, 0);
      outputs.push(...gate.tick({ zone: { ...DEMO_ZONE, id: 'demo' }, sessionId: 'demo-session', sessionStartedAt: 1000, source: 'demo', persons: a.tracking.persons, frameTimeMs: t, now: t }).triggers);
    }
    assert.equal(outputs.length, expected);
    assert.ok(outputs.every((r) => r.timestampBasis === 'simulation'));
  });
}
