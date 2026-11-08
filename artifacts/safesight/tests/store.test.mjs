import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const data = new Map();
let failWrites = false;
let failReads = false;
globalThis.localStorage = {
  getItem: (key) => { if (failReads) throw new Error('Storage blocked'); return data.get(key) ?? null; },
  setItem: (key, value) => { if (failWrites) throw new Error('Quota exceeded'); data.set(key, String(value)); },
};
globalThis.window = new EventTarget();
const store = await import('../src/lib/store.ts');
const EV = 'safesight.events.v1', PREF = 'safesight.prefs.v1';
const event = { source: 'live', kind: 'risk', level: 'moderate', score: 48, evidence: ['fixture'], detections: 2 };
beforeEach(() => { data.clear(); failWrites = false; failReads = false; store.getEvents(); store.getPrefs(); });
test('invalid preference types cannot reach inference or controls', () => {
  data.set(PREF, JSON.stringify({ minConfidence: 'bad', intervalMs: -1, maxEvents: null, audioAlerts: 'false' }));
  assert.deepEqual(store.getPrefs(), store.DEFAULT_PREFS);
});
test('invalid event container is readable without crashing', () => {
  data.set(EV, '{"not":"an array"}');
  assert.deepEqual(store.getEvents(), []);
});
test('failed persistence is reported and does not pretend an event was saved', () => {
  failWrites = true;
  assert.equal(store.addEvent(event), null);
  assert.deepEqual(store.getEvents(), []);
});
test('a corrupted history is not overwritten by automatic logging', () => {
  const original = '[{"unrecognized":"record"}]';
  data.set(EV, original);
  assert.equal(store.addEvent(event), null);
  assert.equal(data.get(EV), original);
});
test('valid existing history survives preferences and reload-style reads', () => {
  assert.ok(store.addEvent(event));
  assert.equal(store.setPrefs({ showPose: false }), true);
  assert.equal(store.getEvents().length, 1);
  assert.equal(store.getPrefs().showPose, false);
});
test('retention keeps newest records without changing their source', () => {
  store.setPrefs({ maxEvents: 50 });
  for (let i = 0; i < 55; i++) store.addEvent({ ...event, source: i % 2 ? 'demo' : 'live', ts: 1000 + i });
  assert.equal(store.getEvents().length, 50);
  assert.equal(store.getEvents()[0].ts, 1054);
  assert.equal(store.getEvents().at(-1).ts, 1005);
});
test('delete and clear only modify explicitly requested history', () => {
  const a = store.addEvent(event), b = store.addEvent({ ...event, source: 'demo' });
  store.deleteEvent(a.id);
  assert.deepEqual(store.getEvents().map((e) => e.id), [b.id]);
  store.clearEvents();
  assert.deepEqual(store.getEvents(), []);
});
test('invalid rows are isolated while automatic deletes cannot silently discard the original data', () => {
  const saved = store.addEvent(event);
  data.set(EV, JSON.stringify([saved, { invalid: true }]));
  assert.deepEqual(store.getEvents(), [saved]);
  assert.equal(store.deleteEvent(saved.id), false);
  assert.equal(JSON.parse(data.get(EV)).length, 2);
});
test('blocked reads never permit overwriting unknown history; failed preference resets return false', () => {
  const saved = store.addEvent(event);
  failReads = true;
  assert.equal(store.addEvent(event), null);
  assert.equal(JSON.parse(data.get(EV))[0].id, saved.id);
  failWrites = true; assert.equal(store.resetPrefs(), false);
});
test('corruption is recoverable only by an explicit successful reset', () => {
  data.set(PREF, '{bad json'); data.set(EV, 'null');
  assert.deepEqual(store.getPrefs(), store.DEFAULT_PREFS); assert.deepEqual(store.getEvents(), []);
  assert.equal(store.setPrefs({ audioAlerts: true }), false);
  assert.equal(store.clearEvents(), true); assert.equal(store.resetPrefs(), true);
  assert.ok(store.addEvent(event)); assert.equal(store.setPrefs({ showBoxes: false }), true);
});
test('damaged preferences cannot apply fallback retention or automatically write history', () => {
  const existing = store.addEvent(event);
  data.set(PREF, JSON.stringify({ maxEvents: -5 }));
  assert.equal(store.addEvent(event), null);
  assert.deepEqual(store.getEvents(), [existing]);
});
