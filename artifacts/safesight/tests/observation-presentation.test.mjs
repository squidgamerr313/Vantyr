import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentObservation, presentCurrentObservation, presentSavedObservation } from '../src/lib/observation-presentation.ts';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { person, peopleFrame } from './fixtures/people.mjs';
import { motionEvidence } from '../src/lib/motion-evidence.ts';

const tracked = (extra = {}) => ({
  id: 'p2', label: 'Person 2', status: 'tracked', posture: 'upright', horizontalMs: 0,
  observedMs: 3000, observations: [], limitations: [], ...extra,
});
const motion = (persons = [tracked()], extra = {}) => ({
  version: 'person-motion-v1', timestampBasis: 'decoded-video', quality: 'observing', persons, limitations: [], ...extra,
});
const saved = (extra = {}) => ({
  id: 'old-record', ts: 1700000000000, source: 'live', kind: 'risk', score: 52, level: 'moderate',
  evidence: ['Original recorded text'], detections: 1, ...extra,
});
function freezeDeep(v) {
  if (v && typeof v === 'object') { Object.values(v).forEach(freezeDeep); Object.freeze(v); }
  return v;
}
test('ordinary zero score is a rule non-trigger, never a certified-safe scene', () => {
  const p = presentObservation({ source: 'live', score: 0, level: 'low', motion: motion() });
  assert.match(p.observed.join(' '), /Person 2: upright/);
  assert.match(p.observed.join(' '), /No configured rule triggered.*not a safety verdict/);
  assert.match(p.unknown.join(' '), /do not establish a fall, push, injury or intent/);
  assert.match(p.checks.join(' '), /supervision/);
  assert.deepEqual(p.technical, { score: 0, level: 'low' });
});
test('horizontal details come from the person evidence, not score 52', () => {
  const p = presentSavedObservation(saved({ motion: motion([tracked({ posture: 'horizontal', horizontalMs: 2300 })]) }));
  assert.equal(p.observed[0], 'Person 2: near-horizontal torso for 2.3 seconds.');
  assert.match(p.unknown.join(' '), /intentional lying down/);
  assert.match(p.checks.join(' '), /whether the person needs assistance/);
  assert.deepEqual(p.technical, { score: 52, level: 'moderate' });
  assert.doesNotMatch(p.headline, /fall detected|injury detected/i);
});
test('legacy scores cannot manufacture people, duration or fall recognition', () => {
  for (const score of [35, 48, 52, 72]) {
    const event = freezeDeep(saved({ score, evidence: ['Legacy FALL DETECTED wording retained as original text.'] }));
    const before = JSON.stringify(event), p = presentSavedObservation(event);
    assert.match(p.unknown.join(' '), /labels and measured durations are unavailable/);
    assert.doesNotMatch(p.observed.join(' '), /Person \d|seconds|FALL DETECTED/);
    assert.deepEqual(p.originalEvidence, event.evidence);
    assert.equal(p.technical.score, score);
    assert.equal(JSON.stringify(event), before);
  }
});
test('stopped, waiting and unavailable states suppress even a supplied cached score', () => {
  for (const availability of ['stopped', 'waiting', 'unavailable']) {
    const p = presentObservation({ availability, source: 'live', score: 72, level: 'high', motion: motion() });
    assert.equal(p.technical, null);
    assert.match(p.unknown.join(' '), /does not establish.*safe/);
    assert.doesNotMatch(p.observed.join(' '), /Person 2|upright/);
    assert.match(p.sourceHint, /No current scene/);
  }
  assert.equal(presentCurrentObservation(null, 'live').headline, 'No observation yet');
  assert.equal(presentCurrentObservation(null, undefined, 'stopped').sourceLabel, 'No active source');
});
test('limited/ambiguous evidence is not converted into measured posture', () => {
  const p = presentObservation({ source: 'live', score: 0, level: 'uncertain',
    motion: motion([tracked({ id: null, status: 'uncertain', posture: 'horizontal', horizontalMs: 10000 })], { quality: 'limited' }) });
  assert.match(p.headline, /limited/);
  assert.doesNotMatch(p.observed.join(' '), /10.0|near-horizontal/);
  assert.match(p.unknown.join(' '), /Missing or ambiguous poses/);
  assert.match(p.checks.join(' '), /clear person evidence/);
});
test('object proximity and counts separate observation, limitation and suggested check', () => {
  const p = presentObservation({ score: 48, level: 'moderate', source: 'live', motion: motion(),
    evidence: ['Person 2 and a knife appear close in the image. Depth and intent are unknown; verify handling.',
      '4 people detected in frame. Check access routes; this alone does not establish overcrowding.'] });
  assert.deepEqual(p.observed, ['Person 2 and a knife appear close in the image.', '4 people detected in frame.']);
  assert.match(p.unknown.join(' '), /Depth and intent are unknown/);
  assert.match(p.unknown.join(' '), /does not establish overcrowding/);
  assert.match(p.checks.join(' '), /handled/);
  assert.match(p.checks.join(' '), /access routes/);
});
test('stored simulation stays scripted and historical, never live inference now', () => {
  const p = presentSavedObservation(saved({ source: 'demo', motion: motion([], { timestampBasis: 'simulation' }) }));
  assert.equal(p.sourceLabel, 'Saved simulation');
  assert.match(p.sourceHint, /not a current safety assessment/);
  assert.match(p.timing, /not real-camera evidence/);
  assert.equal(p.recorded, true);
});
test('current timing provenance is passed through and simulation overrides camera timing', () => {
  const engine = createRiskAssessor(), r = engine.assess(peopleFrame([person(.3)]), 1000, 600, 0);
  assert.match(presentCurrentObservation(r, 'live', 'available', 'decoded-video').timing, /decoded video timestamps/);
  assert.match(presentCurrentObservation(r, 'live').timing, /Processing-time/);
  const demo = presentCurrentObservation(r, 'demo', 'available', 'decoded-video');
  assert.equal(demo.sourceLabel, 'Scripted simulation');
  assert.match(demo.sourceHint, /not live camera inference/);
  assert.match(demo.timing, /Scripted simulation/);
});
test('movement context is descriptive and leaves rule values untouched', () => {
  const engine = createRiskAssessor();
  engine.assess(peopleFrame([person(.3, { y: .35 })]), 1000, 600, 0);
  const r = engine.assess(peopleFrame([person(.3, { y: .45, angle: 70 })]), 1000, 600, 300);
  const before = JSON.stringify(r), p = presentCurrentObservation(freezeDeep(r), 'live');
  assert.match(p.observed.join(' '), /rapid torso-angle change/);
  assert.match(p.observed.join(' '), /downward image movement/);
  assert.equal(p.technical.score, 0);
  assert.equal(JSON.stringify(r), before);
});
test('actual scored posture sequence retains observed timing and original stored evidence', () => {
  const engine = createRiskAssessor();
  const f = peopleFrame([person(.3, { angle: 90 })]);
  engine.assess(f, 1000, 600, 0);
  const r = engine.assess(f, 1000, 600, 2300);
  const event = freezeDeep(saved({ evidence: r.evidence, motion: motionEvidence(r.tracking, 'decoded-video') }));
  const before = JSON.stringify(event);
  const p = presentSavedObservation(event);
  assert.match(p.observed.join(' '), /Person 1: near-horizontal torso for 2.3 seconds/);
  assert.equal(p.technical.score, 52);
  assert.equal(JSON.stringify(event), before);
});
test('AI snapshots and zone observations cannot be interpreted by the risk presenter', () => {
  assert.throws(() => presentSavedObservation(saved({ kind: 'analysis' })), /Only saved risk/);
  assert.throws(() => presentSavedObservation(saved({ kind: 'zone' })), /Only saved risk/);
});
test('missing and invalid numeric context is not replaced with zero or inferred duration', () => {
  for (const score of [null, undefined, NaN, Infinity, -1, 101]) {
    const p = presentObservation({ source: 'live', recorded: true, score, level: 'low', evidence: [] });
    assert.equal(p.technical, null);
    assert.match(p.observed.join(' '), /not saved/);
    assert.doesNotMatch(p.observed.join(' '), /No configured rule triggered/);
  }
});
