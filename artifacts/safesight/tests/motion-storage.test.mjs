import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { motionEvidence } from '../src/lib/motion-evidence.ts';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { peopleFrame, person } from './fixtures/people.mjs';
const data = new Map();
globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
globalThis.window = new EventTarget();
const store = await import('../src/lib/store.ts');
const legacy = { id: 'legacy', ts: 123, source: 'demo', kind: 'risk', level: 'moderate', score: 52, detections: 1, evidence: ['Old event with no tracking metadata'] };
beforeEach(() => { data.clear(); store.getEvents(); store.getPrefs(); });
function assessment() {
  const engine = createRiskAssessor();
  engine.assess(peopleFrame([person(.3, { angle: 90 })]), 1000, 600, 0);
  return engine.assess(peopleFrame([person(.3, { angle: 90 })]), 1000, 600, 2000);
}
test('new tracking evidence persists alongside unchanged legacy history and survives a raw JSON reload', () => {
  data.set(store.STORAGE_KEYS.events, JSON.stringify([legacy]));
  const r = assessment(), motion = motionEvidence(r.tracking, 'decoded-video');
  assert.ok(store.addEvent({ source: 'live', kind: 'risk', level: r.level, score: r.score, evidence: r.evidence, detections: 1, motion }));
  const reloaded = JSON.parse(data.get(store.STORAGE_KEYS.events));
  assert.deepEqual(reloaded[1], legacy);
  assert.equal(reloaded[0].motion.persons[0].label, 'Person 1');
  assert.equal(reloaded[0].motion.persons[0].horizontalMs, 2000);
  assert.equal(store.getEvents().length, 2);
});
test('stored motion metadata contains no image, geometry, landmarks or rolling frame buffer', () => {
  const details = motionEvidence(assessment().tracking, 'simulation');
  assert.equal(details.timestampBasis, 'simulation');
  const serialized = JSON.stringify(details);
  for (const key of ['box', 'landmarks', 'samples', 'torso', 'image', 'data:image']) assert.ok(!serialized.includes(`"${key}"`));
  assert.deepEqual(Object.keys(details.persons[0]).sort(), ['id', 'label', 'status', 'posture', 'horizontalMs', 'observedMs', 'observations', 'limitations'].sort());
});
test('invalid optional motion metadata is isolated without rewriting the original history', () => {
  const damaged = { ...legacy, id: 'bad', motion: { ...motionEvidence(assessment().tracking, 'decoded-video'), persons: [{ id: 'p1', horizontalMs: 'bad' }] } };
  const original = JSON.stringify([legacy, damaged]);
  data.set(store.STORAGE_KEYS.events, original);
  assert.deepEqual(store.getEvents(), [legacy]);
  assert.equal(store.addEvent({ ...legacy, id: undefined }), null);
  assert.equal(data.get(store.STORAGE_KEYS.events), original);
});
