import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoEvents, isExampleEvent } from '../src/lib/demo-events.ts';
import { validEvent } from '../src/lib/storage-validation.ts';

const data = new Map();
let failWrites = false;
let failReads = false;
globalThis.window = new EventTarget();
globalThis.localStorage = {
  getItem: (key) => { if (failReads) throw Error('blocked'); return data.get(key) ?? null; },
  setItem: (key, value) => { if (failWrites) throw Error('full'); data.set(key, String(value)); },
};
const store = await import('../src/lib/store.ts');
const key = store.STORAGE_KEYS.events;
beforeEach(() => {
  data.clear(); failWrites = false; failReads = false;
  store.getEvents(); store.getPrefs();
});
test('four labeled examples validate and contain no real-camera or AI assessments', () => {
  const examples = createDemoEvents();
  assert.equal(examples.length, 4);
  assert.ok(examples.every(validEvent));
  assert.ok(examples.every(isExampleEvent));
  assert.ok(examples.every((e) => e.score === null && e.kind !== 'analysis'));
  assert.deepEqual(examples.map((e) => e.review.status), ['open', 'open', 'reviewed', 'resolved']);
});
test('loading preserves history and reviews, persists on read and deduplicates', () => {
  const original = store.addEvent({ source: 'live', kind: 'risk', level: 'uncertain', score: null, evidence: ['actual saved observation'], detections: 1 });
  assert.equal(store.loadDemoEvents().added, 4);
  assert.deepEqual(store.getEvents().find((e) => e.id === original.id), original);
  const demo = store.getEvents().find((e) => isExampleEvent(e) && e.review.status === 'open');
  assert.ok(store.reviewEvent(demo.id, 'reviewed', 'My practice review'));
  const saved = data.get(key);
  assert.deepEqual(store.loadDemoEvents(), { added: 0 });
  assert.equal(data.get(key), saved);
  assert.equal(JSON.parse(saved).length, 5);
});
test('full history is never trimmed to make room for examples', () => {
  store.setPrefs({ maxEvents: 50 });
  for (let i = 0; i < 48; i++) store.addEvent({ source: 'live', kind: 'risk', level: 'uncertain', score: null, evidence: [], detections: 0 });
  const saved = data.get(key);
  assert.ok(store.loadDemoEvents().error);
  assert.equal(data.get(key), saved);
});
test('corrupt history and preferences are preserved', () => {
  data.set(key, 'damaged history');
  assert.ok(store.loadDemoEvents().error);
  assert.equal(data.get(key), 'damaged history');
  data.delete(key);
  data.set(store.STORAGE_KEYS.prefs, '{"maxEvents":"invalid"}');
  assert.ok(store.loadDemoEvents().error);
  assert.equal(data.has(key), false);
});
test('storage read/write failures do not report success or overwrite history', () => {
  failReads = true;
  assert.ok(store.loadDemoEvents().error);
  assert.equal(data.has(key), false);
  failReads = false;
  failWrites = true;
  assert.ok(store.loadDemoEvents().error);
  assert.equal(data.has(key), false);
});
