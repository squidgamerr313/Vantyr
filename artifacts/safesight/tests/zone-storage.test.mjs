import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeZoneSessions } from '../src/lib/zone-records.ts';
import { validEvent } from '../src/lib/storage-validation.ts';
const data = new Map(); let fail = false;
globalThis.localStorage = {
  getItem: (k) => data.get(k) ?? null,
  setItem: (k, v) => { if (fail) throw new Error('Quota exceeded'); data.set(k, v); },
};
const store = await import('../src/lib/store.ts');
const outbox = await import('../src/lib/zone-outbox.ts');
const legacy = { id: 'legacy', ts: 500, source: 'live', kind: 'risk', level: 'moderate', score: 52, evidence: ['Original evidence'], detections: 1 };
const candidate = () => ({
  source: 'demo', kind: 'zone', level: 'uncertain', score: null, evidence: ['Person 1 inside Bench A for 4 seconds'], detections: 1, ts: 6000,
  zone: { version: 'zone-v1', sessionId: 'session-a', sessionStartedAt: 1000, episodeId: 'episode-a', zone: { id: 'zone-a', name: 'Bench A', rect: [.1, .5, .3, .3], dwellSec: 4 }, personId: 'p1', personLabel: 'Person 1', dwellMs: 4000, timestampBasis: 'simulation' },
  review: { status: 'open', actions: [] },
});
beforeEach(() => { fail = false; data.clear(); data.set(store.STORAGE_KEYS.events, JSON.stringify([legacy])); });
test('zone events persist without scores, geometry is only the user-drawn rectangle, and legacy history is unchanged', () => {
  const event = store.addEvent(candidate());
  assert.ok(event);
  const json = data.get(store.STORAGE_KEYS.events), reloaded = JSON.parse(json);
  assert.deepEqual(reloaded[1], legacy);
  assert.equal(reloaded[0].kind, 'zone'); assert.equal(reloaded[0].score, null);
  assert.equal(reloaded[0].review.status, 'open');
  assert.deepEqual(Object.keys(reloaded[0].zone).sort(), ['version', 'sessionId', 'sessionStartedAt', 'episodeId', 'zone', 'personId', 'personLabel', 'dwellMs', 'timestampBasis'].sort());
  for (const word of ['image', 'landmarks', 'samples', 'torso', 'box']) assert.ok(!json.includes(`"${word}"`));
  assert.ok(store.getEvents().every(validEvent));
});
test('retrying the same occupancy episode does not duplicate it', () => {
  const first = store.addEvent(candidate()), second = store.addEvent(candidate());
  assert.equal(first.id, second.id); assert.equal(store.getEvents().length, 2);
});
test('only explicit valid human actions update status, while original evidence is immutable', () => {
  const event = store.addEvent(candidate());
  assert.equal(store.reviewZoneEvent(event.id, 'resolved', 'skip review', 6500), false);
  assert.equal(store.reviewZoneEvent(event.id, 'reviewed', 'Area checked', 7000), true);
  assert.equal(store.reviewZoneEvent(event.id, 'resolved', 'Access restored', 8000, { confirmed: true }), true);
  const final = store.getEvents()[0];
  assert.equal(final.review.status, 'resolved');
  assert.deepEqual(final.evidence, event.evidence); assert.deepEqual(final.zone, event.zone); assert.equal(final.ts, event.ts);
  assert.deepEqual(final.review.actions.map((a) => a.at), [7000, 8000]);
  assert.equal(store.reviewZoneEvent(event.id, 'dismissed', 'late change', 9000), false);
});
test('dismissal is explicit, survives a raw reload and counts as first human response', () => {
  const event = store.addEvent(candidate());
  assert.equal(store.reviewZoneEvent(event.id, 'dismissed', 'Known authorized activity', 8500), true);
  const reloaded = JSON.parse(data.get(store.STORAGE_KEYS.events));
  assert.equal(reloaded[0].review.status, 'dismissed');
  const summary = summarizeZoneSessions(reloaded)[0];
  assert.equal(summary.dismissed, 1); assert.equal(summary.meanFirstReviewMs, 2500);
});
test('failed event saves and failed review writes never pretend success and can be retried', () => {
  fail = true; assert.equal(store.addEvent(candidate()), null);
  assert.deepEqual(JSON.parse(data.get(store.STORAGE_KEYS.events)), [legacy]);
  fail = false; const event = store.addEvent(candidate()); const original = data.get(store.STORAGE_KEYS.events);
  fail = true; assert.equal(store.reviewZoneEvent(event.id, 'reviewed', 'Keep this draft', 7000), false);
  assert.equal(data.get(store.STORAGE_KEYS.events), original); assert.equal(store.getEvents()[0].review.status, 'open');
  fail = false; assert.equal(store.reviewZoneEvent(event.id, 'reviewed', 'Keep this draft', 7000), true);
});
test('bad or oversized review metadata is isolated without rewriting the original history', () => {
  const bad = { ...candidate(), id: 'bad', review: { status: 'resolved', actions: [] } };
  const raw = JSON.stringify([legacy, bad]); data.set(store.STORAGE_KEYS.events, raw);
  assert.deepEqual(store.getEvents(), [legacy]);
  assert.equal(store.addEvent(candidate()), null);
  assert.equal(data.get(store.STORAGE_KEYS.events), raw);
  assert.equal(store.reviewZoneEvent(legacy.id, 'reviewed', 'Not a zone', 7000), false);
});
test('review validation rejects skipped, out-of-order, forged and overlong outcomes', () => {
  const event = { ...candidate(), id: 'test' };
  for (const review of [
    { status: 'resolved', actions: [{ status: 'resolved', note: '', at: 7000 }] },
    { status: 'reviewed', actions: [{ status: 'reviewed', note: '', at: 5000 }] },
    { status: 'resolved', actions: [{ status: 'reviewed', note: '', at: 8000 }, { status: 'resolved', note: '', at: 7000 }] },
    { status: 'reviewed', actions: [{ status: 'reviewed', note: 'x'.repeat(1001), at: 7000 }] },
  ]) assert.equal(validEvent({ ...event, review }), false);
  const saved = store.addEvent(candidate());
  assert.equal(store.reviewZoneEvent(saved.id, 'reviewed', 'x'.repeat(1001), 7000), false);
  assert.equal(store.reviewZoneEvent(saved.id, 'reviewed', '', NaN), false);
});
test('review times never precede the event even if the local clock moves backwards', () => {
  const event = store.addEvent(candidate());
  assert.ok(store.reviewZoneEvent(event.id, 'reviewed', '', 100));
  assert.equal(store.getEvents()[0].review.actions[0].at, 6000);
});
test('zone records reject source mismatch, fake scores and invalid geometry; absent reviews remain unrecorded', () => {
  const event = { ...candidate(), id: 'test' };
  assert.equal(validEvent({ ...event, score: 48 }), false);
  assert.equal(validEvent({ ...event, review: undefined }), true);
  assert.equal(validEvent({ ...event, source: 'live' }), false);
  assert.equal(validEvent({ ...event, zone: { ...event.zone, zone: { ...event.zone.zone, rect: [0, 0, 2, 2] } } }), false);
});
test('session summaries separate sources/sessions, exclude old records and derive outcomes from saved actions', () => {
  const a = store.addEvent(candidate());
  store.reviewZoneEvent(a.id, 'reviewed', '', 7000);
  store.addEvent({ ...candidate(), source: 'live', zone: { ...candidate().zone, timestampBasis: 'decoded-video', episodeId: 'episode-b' } });
  store.addEvent({ ...candidate(), zone: { ...candidate().zone, sessionId: 'session-b', episodeId: 'episode-c' } });
  const summaries = summarizeZoneSessions(store.getEvents());
  assert.equal(summaries.length, 3);
  assert.equal(summaries.reduce((n, s) => n + s.total, 0), 3);
  assert.equal(summaries.find((s) => s.id === 'session-a' && s.source === 'demo').reviewed, 1);
  assert.equal(summaries.find((s) => s.id === 'session-a' && s.source === 'live').open, 1);
});
test('unsaved flags remain in the tab outbox until an explicit successful retry, without duplicate episodes', () => {
  const event = { ...candidate(), id: 'pending' };
  fail = true;
  outbox.queueZoneFlag(event); outbox.queueZoneFlag(event);
  assert.equal(outbox.getPendingZoneFlags().length, 1);
  assert.equal(outbox.retryZoneFlag('episode-a'), false);
  assert.equal(outbox.getPendingZoneFlags()[0].id, 'pending');
  assert.deepEqual(JSON.parse(data.get(store.STORAGE_KEYS.events)), [legacy]);
  fail = false; assert.equal(outbox.retryZoneFlag('episode-a'), true);
  assert.equal(outbox.getPendingZoneFlags().length, 0);
  assert.equal(store.getEvents().filter((e) => e.kind === 'zone').length, 1);
  assert.equal(outbox.retryZoneFlag('episode-a'), false);
});
