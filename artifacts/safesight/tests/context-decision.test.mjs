import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextDecisionLayer } from '../src/lib/context-decision.ts';
import { candidateAdmission, CANDIDATES } from '../src/lib/candidate-admission.ts';
import { validContextDecision } from '../src/lib/context-validation.ts';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { person, peopleFrame } from './fixtures/people.mjs';
import { presentCurrentObservation, presentSavedObservation } from '../src/lib/observation-presentation.ts';
import { validEvent, parseEvents } from '../src/lib/storage-validation.ts';

function pipeline() {
  const assessor = createRiskAssessor(), layer = createContextDecisionLayer();
  return { reset() { assessor.reset(); layer.reset(); },
    frame(t, people = [person(.3, { angle: 90 })], options = {}) {
      const result = peopleFrame(people, { time: t, ...options });
      if (options.detections) result.detections.push(...options.detections);
      const a = assessor.assess(result, 1000, 600, options.now ?? t, { source: options.source ?? 'live' });
      const decision = layer.decide({ result, tracking: a.tracking, width: options.width ?? 1000, height: 600,
        now: options.now ?? t, source: options.source ?? 'live', sessionId: options.sessionId ?? 'session-a', ...options });
      assert.ok(validContextDecision(decision), JSON.stringify(decision));
      return { ...a, decision };
    },
  };
}
const observed = () => {
  const p = pipeline(); p.frame(0); p.frame(1000); return p.frame(2000);
};
export const contextEvent = () => {
  const a = observed();
  return { id: 'context-event', ts: 10000, source: 'live', kind: 'risk', score: null, level: 'uncertain',
    detections: 1, evidence: a.decision.reasons, decision: a.decision, review: { status: 'open', actions: [] } };
};
test('no report or caller flag enables rejected/unknown candidates', () => {
  for (const c of [...CANDIDATES, { id: 'invented' }]) {
    const admission = candidateAdmission(c.id, { passed: true });
    assert.equal(admission.enabled, false);
    assert.ok(admission.reason.length > 20);
    assert.equal(Object.keys(admission.gates).length, 5);
  }
});
test('single posture, crowds and ordinary tools cannot drive a human-check alert or imply ownership', () => {
  const p = pipeline();
  const knife = { id: 'knife', label: 'knife', confidence: .9, box: [300, 220, 40, 30] };
  const a = p.frame(0, [person(.3), person(.55), person(.8), person(.1)], { detections: [knife] });
  assert.ok(a.score > 0); // frozen heuristic remains measurable, NOT workflow authority
  assert.equal(a.decision.priority, 'context'); assert.deepEqual(a.decision.episodes, []);
  assert.equal(a.decision.facts.find((f) => f.kind === 'tool-proximity').owner, null);
  assert.equal(a.decision.fallState, 'unavailable');
});
test('actual per-person duration suggests a descriptive check once, never a fall or harm percentage', () => {
  const p = pipeline();
  assert.equal(p.frame(0).decision.priority, 'none');
  assert.equal(p.frame(1000).decision.priority, 'none');
  const a = p.frame(2000);
  assert.equal(a.decision.priority, 'check'); assert.equal(a.decision.episodes.length, 1);
  const d = a.decision;
  assert.equal(d.facts[0].elapsedMs, 2000);
  for (const t of [2000, 3000, 4000, 5000, 6000]) assert.deepEqual(p.frame(t).decision.episodes, []);
  const shown = presentCurrentObservation(a, 'live');
  assert.equal(shown.headline, 'Human check suggested'); assert.equal(shown.technical, null);
});
test('short upright flicker does not rearm; sustained visible upright may start a new check, not resolve the old review', () => {
  const p = pipeline(); p.frame(0); p.frame(1000);
  const first = p.frame(2000).decision.episodes[0];
  p.frame(2100, [person(.3)]); p.frame(2200); p.frame(3200);
  assert.deepEqual(p.frame(4200).decision.episodes, []);
  p.frame(4300, [person(.3)]); p.frame(5300, [person(.3)]);
  p.frame(5400); p.frame(6400);
  const second = p.frame(7400).decision.episodes[0];
  assert.ok(second); assert.notEqual(first, second);
});
test('missing poses, ambiguity, loss and new owners cannot inherit a check clock', () => {
  for (const interrupt of [
    (p) => p.frame(1500, []),
    (p) => p.frame(1500, [person(.3, { angle: 90, visibility: .1 })]),
    (p) => p.frame(1500, [person(.3, { angle: 90 }), person(.35)]),
  ]) {
    const p = pipeline(); p.frame(0); p.frame(1000); interrupt(p);
    assert.equal(p.frame(2000).decision.priority, 'none');
    assert.equal(p.frame(3000).decision.priority, 'none');
  }
});
test('stale/reversed clocks, sessions, source, aspect and explicit reset discard support', () => {
  for (const options of [{ now: 4000 }, { source: 'demo' }, { sessionId: 'session-b' }, { width: 1200 }]) {
    const p = pipeline(); p.frame(0); p.frame(1000);
    assert.deepEqual(p.frame(2000, undefined, options).decision.episodes, []);
  }
  const p = pipeline(); p.frame(0); p.frame(1000);
  assert.equal(p.frame(1000, undefined, { now: 4000 }).decision.freshness, 'unavailable');
  assert.equal(p.frame(900).decision.priority, 'none');
  p.reset(); assert.equal(p.frame(5000).decision.priority, 'none');
  assert.equal(p.frame(undefined).decision.freshness, 'unavailable');
});
test('per-person/pair evidence remains separate from applied zone context', () => {
  const p = pipeline();
  const a = p.frame(0, [person(.3)], { zone: { config: { id: 'z', name: 'Bench', dwellSec: 4, rect: [.1, .1, .5, .8] },
    progress: { status: 'watching', occupants: [{ id: 'p1', dwellMs: 5000, flagged: true }] } } });
  assert.equal(a.decision.zone.occupants[0].flagged, true);
  assert.equal(a.decision.priority, 'none'); assert.deepEqual(a.decision.episodes, []);
});
test('new metadata survives reload/presentation; legacy observations are never rewritten or synthesized', () => {
  const event = contextEvent(), raw = JSON.stringify(event);
  assert.ok(validEvent(event)); assert.equal(parseEvents(JSON.parse(`[${raw}]`)).invalid, false);
  const p = presentSavedObservation(event);
  assert.equal(p.recorded, true); assert.equal(p.technical, null); assert.match(p.checks.join(' '), /human check/);
  assert.equal(JSON.stringify(event), raw);
  const legacy = { ...event }; delete legacy.decision; legacy.score = 72; legacy.level = 'high';
  assert.ok(validEvent(legacy)); assert.equal(presentSavedObservation(legacy).decision, undefined);
});
test('storage rejects fabricated capabilities, raw media/keypoints, malformed durations and source mismatch', () => {
  for (const mutate of [
    (e) => e.decision.fallState = 'recovered',
    (e) => e.decision.keypoints = [[0, 0]],
    (e) => e.decision.facts[0].box = [0, 0, 1, 1],
    (e) => e.decision.facts[0].elapsedMs = NaN,
    (e) => e.decision.facts[0].owner = 'named-person',
    (e) => e.decision.source = 'demo',
    (e) => e.score = 99,
    (e) => e.decision.priority = 'context',
    (e) => e.decision.episodes = [],
  ]) {
    const e = contextEvent(); mutate(e); assert.equal(validEvent(e), false);
  }
});
