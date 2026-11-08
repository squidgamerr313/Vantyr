import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk, resetRisk, createRiskAssessor } from '../src/lib/risk.ts';
import { createPersonTracker, MAX_SAMPLES } from '../src/lib/person-tracking.ts';
import { person, peopleFrame } from './fixtures/people.mjs';
const assess = (people, t, opts = {}) => assessRisk(peopleFrame(people, opts), opts.width ?? 1000, opts.height ?? 600, t, { source: opts.source ?? 'live' });
beforeEach(resetRisk);
test('two people alternating horizontal postures cannot inherit each other’s duration', () => {
  assess([person(.25, { angle: 90 }), person(.75)], 0);
  assess([person(.25, { angle: 90 }), person(.75)], 1000);
  assess([person(.25), person(.75, { angle: 90 })], 1500);
  assert.equal(assess([person(.25), person(.75, { angle: 90 })], 3000).score, 0);
  assert.equal(assess([person(.25), person(.75, { angle: 90 })], 3500).score, 52);
});
test('a different horizontal person arriving elsewhere cannot inherit the previous person’s clock', () => {
  assess([person(.2, { angle: 90 })], 0);
  assess([person(.2, { angle: 90 })], 2000);
  assert.equal(assess([person(.8, { angle: 90 })], 3000).score, 0);
});
test('changing simulation/live sources starts new posture histories', () => {
  assess([person(.3, { angle: 90 })], 0, { source: 'demo' });
  assert.equal(assess([person(.3, { angle: 90 })], 2000, { source: 'live' }).score, 0);
});
test('detection and pose reordering preserve spatial labels and correct per-person posture', () => {
  const initial = assess([person(.25, { angle: 90 }), person(.75)], 0);
  const left = initial.tracking.persons[0].id, right = initial.tracking.persons[1].id;
  const reordered = assess([person(.75), person(.25, { angle: 90 })], 1500, { poseOrder: [1, 0] });
  assert.equal(reordered.tracking.persons[0].id, right);
  assert.equal(reordered.tracking.persons[0].posture, 'upright');
  assert.equal(reordered.tracking.persons[1].id, left);
  assert.equal(reordered.tracking.persons[1].horizontalMs, 1500);
});
test('overlapping crossings retire ambiguous labels rather than transferring timers', () => {
  const initial = assess([person(.25, { angle: 90 }), person(.75)], 0).tracking.persons.map((p) => p.id);
  assess([person(.35, { angle: 90 }), person(.65)], 1000);
  const crossing = assess([person(.45, { angle: 90 }), person(.55)], 1800);
  assert.ok(crossing.tracking.persons.every((p) => p.id === null && p.status === 'uncertain'));
  assert.equal(crossing.score, 0);
  const separated = assess([person(.75, { angle: 90 }), person(.25)], 2400);
  assert.ok(separated.tracking.persons.every((p) => !initial.includes(p.id)));
  assert.equal(separated.score, 0);
});
test('occluded landmarks keep a uniquely detected label but break posture and movement histories', () => {
  const first = assess([person(.3, { angle: 90 })], 0);
  const hidden = assess([person(.3, { angle: 90, visibility: .5 })], 1200);
  assert.equal(hidden.tracking.persons[0].id, first.tracking.persons[0].id);
  assert.equal(hidden.tracking.persons[0].status, 'missing-pose');
  assert.equal(hidden.tracking.quality, 'limited');
  const visible = assess([person(.3, { angle: 90 })], 2000);
  assert.equal(visible.tracking.persons[0].horizontalMs, 0);
  assert.equal(visible.score, 0);
  assert.equal(assess([person(.3, { angle: 90 })], 4000).score, 52);
});
test('complete track loss retires labels even when a person returns to the same location', () => {
  const first = assess([person(.3, { angle: 90 })], 0).tracking.persons[0].id;
  assess([], 1000);
  const next = assess([person(.3, { angle: 90 })], 2000);
  assert.notEqual(next.tracking.persons[0].id, first);
  assert.equal(next.score, 0);
});
test('decoded time, not repeated calls or inference delays, controls persistence', () => {
  assess([person(.3, { angle: 90 })], 0, { time: 0 });
  const frozen = assess([person(.3, { angle: 90 })], 2000, { time: 0 });
  assert.equal(frozen.score, 0); assert.equal(frozen.tracking.persons[0].horizontalMs, 0);
  const stale = assess([person(.3, { angle: 90 })], 3000, { time: 0 });
  assert.equal(stale.score, 0); assert.equal(stale.tracking.quality, 'limited');
  assert.match(stale.evidence.join(' '), /stale/);
  assess([person(.3, { angle: 90 })], 3100, { time: 10 });
  assert.equal(assess([person(.3, { angle: 90 })], 5100, { time: 2010 }).score, 52);
});
test('uniform resolution changes preserve normalized association and duration', () => {
  const first = assess([person(.3, { angle: 90 })], 0, { width: 1000, height: 600 });
  const larger = assess([person(.3, { angle: 90 })], 2000, { width: 2000, height: 1200 });
  assert.equal(larger.tracking.persons[0].id, first.tracking.persons[0].id);
  assert.equal(larger.score, 52);
});
for (const interval of [40, 120, 500, 2000]) {
  test(`posture thresholds use elapsed time at ${interval}ms frame intervals`, () => {
    let r;
    for (let t = 0; t <= 6000; t += interval) {
      r = assess([person(.3, { angle: 90 })], t, { time: t });
      assert.equal(r.score, t >= 5000 ? 72 : t >= 2000 ? 52 : 0);
    }
  });
}
test('ordinary walking jitter does not create rapid-tilt, downward or high-risk claims', () => {
  for (let t = 0; t <= 6000; t += 120) {
    const r = assess([person(.3 + Math.sin(t / 1000) * .003, { y: .45 + Math.sin(t / 300) * .004, angle: Math.sin(t / 500) * 2 })], t);
    assert.equal(r.score, 0);
    assert.deepEqual(r.tracking.persons[0].observations, []);
  }
});
test('brief ordinary bending and sitting are descriptive observations, not scored emergencies', () => {
  for (const [i, angle] of [0, 20, 45, 70, 45, 20, 0].entries()) {
    assert.equal(assess([person(.3, { angle })], i * 250).score, 0);
  }
  resetRisk();
  for (let i = 0; i <= 5; i++) assert.equal(assess([person(.3, { y: .35 + i * .02 })], i * 200).score, 0);
});
test('intentional lying retains documented posture scores without being called a confirmed fall', () => {
  let r;
  for (let t = 0; t <= 6000; t += 500) r = assess([person(.3, { angle: 90 })], t);
  assert.equal(r.score, 72);
  assert.match(r.evidence.join(' '), /intentional lying down/);
  assert.match(r.evidence.join(' '), /not a confirmed fall/);
});
test('rapid angle change and downward movement are retained as onset context, not extra score', () => {
  assess([person(.3, { y: .35 })], 0);
  const movement = assess([person(.3, { y: .45, angle: 70 })], 300);
  assert.equal(movement.score, 0);
  assert.match(movement.evidence.join(' '), /rapid torso-angle change/);
  assert.match(movement.evidence.join(' '), /downward image movement/);
  for (const t of [600, 900, 1200]) assess([person(.3, { y: .48, angle: 90 })], t);
  const posture = assess([person(.3, { y: .48, angle: 90 })], 2400);
  assert.equal(posture.score, 52);
  assert.match(posture.evidence.join(' '), /rapid torso-angle change.*Observed/);
  assert.match(posture.evidence.join(' '), /near-horizontal torso for 2.1 seconds/);
});
test('shared image translation restarts temporal evidence rather than claiming coordinated activity or camera motion as fact', () => {
  for (const t of [0, 1000, 2000]) assess([person(.2, { angle: 90 }), person(.7, { angle: 90 })], t);
  const moved = assess([person(.25, { y: .5, angle: 90 }), person(.75, { y: .5, angle: 90 })], 2300);
  assert.equal(moved.score, 0);
  assert.equal(moved.tracking.quality, 'limited');
  assert.ok(moved.tracking.persons.every((p) => p.horizontalMs === 0 && !p.observations.length));
  assert.match(moved.tracking.persons[0].limitations.join(' '), /camera movement or coordinated activity/);
});
test('single-person camera motion cannot be disambiguated and is disclosed, not classified as a push', () => {
  assess([person(.3, { y: .35 })], 0);
  const r = assess([person(.3, { y: .45, angle: 70 })], 300);
  assert.equal(r.score, 0);
  assert.match(r.tracking.limitations.join(' '), /Camera movement/);
  assert.match(r.tracking.limitations.join(' '), /do not confirm a push/);
});
test('backward video time, aspect changes and explicit session resets clear histories', () => {
  assess([person(.3, { angle: 90 })], 0, { time: 1000 });
  assess([person(.3, { angle: 90 })], 2000, { time: 3000 });
  assert.equal(assess([person(.3, { angle: 90 })], 2100, { time: 0 }).score, 0);
  assert.equal(assess([person(.3, { angle: 90 })], 2200, { width: 600, height: 1000, time: 100 }).score, 0);
  resetRisk();
  assert.equal(assess([person(.3, { angle: 90 })], 2300).tracking.persons[0].id, 'p1');
});
test('invalid dimensions, nonfinite timestamps and unusable landmarks produce limited evidence', () => {
  const engine = createRiskAssessor();
  const frame = peopleFrame([person(.3)]);
  assert.equal(engine.assess(frame, 0, 600, 0).tracking.quality, 'limited');
  assert.equal(engine.assess({ ...frame, frameTimeMs: NaN }, 1000, 600, 0).tracking.quality, 'limited');
  frame.landmarks[0][11].x = NaN;
  assert.equal(engine.assess(frame, 1000, 600, 100).tracking.persons[0].status, 'missing-pose');
});
test('tracking state and sample buffers remain bounded over long sessions and excessive input', () => {
  const engine = createRiskAssessor();
  const f = peopleFrame([person(.2), person(.5), person(.8)]);
  for (let i = 0; i < 2000; i++) engine.assess(f, 1000, 600, i * 40);
  assert.equal(engine.stats().tracks, 3);
  assert.ok(engine.stats().samples <= 3 * MAX_SAMPLES);
  const tracker = createPersonTracker();
  const many = peopleFrame(Array.from({ length: 100 }, (_, i) => person(i / 100)));
  assert.ok(tracker.update(many, 1000, 600, 0).persons.length <= 20);
  assert.ok(tracker.stats().tracks <= 20);
});
test('the track cap cannot evict another person already matched later in the same frame', () => {
  const tracker = createPersonTracker();
  const detections = Array.from({ length: 20 }, (_, i) => ({
    id: `index-${i}`, label: 'person', confidence: .9, box: [(.1 + i % 5 * .2) * 1000, (.1 + Math.floor(i / 5) * .25) * 600, 80, 90],
  }));
  const frame = { detections, landmarks: [], latency: 0 };
  const original = tracker.update(frame, 1000, 600, 0).persons;
  const inserted = { id: 'new', label: 'person', confidence: .9, box: [100, .21 * 600, 80, 90] };
  const next = tracker.update({ ...frame, detections: [inserted, ...detections.slice(0, 19)] }, 1000, 600, 120);
  assert.equal(next.persons[0].id, 'p21');
  assert.deepEqual(next.persons.slice(1).map((p) => p.id), original.slice(0, 19).map((p) => p.id));
  const third = tracker.update({ ...frame, detections: [inserted, ...detections.slice(0, 19)] }, 1000, 600, 240);
  assert.deepEqual(third.persons.map((p) => p.id), next.persons.map((p) => p.id));
});
