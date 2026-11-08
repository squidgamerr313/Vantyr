import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { validEvent, parseEvents } from '../src/lib/storage-validation.ts';
import { reviewOutcome, HUMAN_OUTCOMES, MAX_REVIEW_ACTIONS, summarizeZoneSessions } from '../src/lib/zone-records.ts';
const data = new Map();
let failRead = false, failWrite = false;
globalThis.localStorage = {
  getItem: (key) => { if (failRead) throw Error('blocked'); return data.get(key) ?? null; },
  setItem: (key, value) => { if (failWrite) throw Error('full'); data.set(key, String(value)); },
};
globalThis.window = new EventTarget();
const store = await import('../src/lib/store.ts');
const key = store.STORAGE_KEYS.events;
const risk = { id: 'risk', ts: 500, source: 'live', kind: 'risk', level: 'moderate', score: 52, detections: 1, evidence: ['Original rule text'] };
const ai = { ...risk, id: 'ai', kind: 'analysis', summary: 'Legacy AI opinion', limitations: 'One snapshot' };
const zone = { ...risk, id: 'zone', source: 'demo', kind: 'zone', level: 'uncertain', score: null,
  zone: { version: 'zone-v1', sessionId: 'session', sessionStartedAt: 100, episodeId: 'episode', zone: { id: 'z', name: 'Bench', rect: [.1, .2, .3, .4], dwellSec: 1 }, personId: 'p1', personLabel: 'Person 1', dwellMs: 1000, timestampBasis: 'simulation' },
  review: { status: 'open', actions: [] },
};
const writeRows = (rows) => data.set(key, JSON.stringify(rows));
beforeEach(() => { failRead = false; failWrite = false; data.clear(); store.getEvents(); store.getPrefs(); writeRows([risk, ai, zone]); });
const current = (id = 'risk') => store.getEvents().find((e) => e.id === id);
const act = (status, options = {}, id = 'risk', at = 1000, note = 'Human note') =>
  store.reviewEvent(id, status, note, at, options);

test('each human outcome persists separately from status and original risk, source and person evidence', () => {
  for (const outcome of HUMAN_OUTCOMES) {
    writeRows([risk, ai, zone]);
    assert.equal(act('reviewed', { outcome, expectedReview: null }), true);
    const row = current();
    assert.equal(row.review.status, 'reviewed');
    assert.equal(reviewOutcome(row.review), outcome);
    const { review, ...evidence } = row;
    assert.deepEqual(evidence, risk);
    assert.deepEqual(current('ai'), ai);
    assert.deepEqual(current('zone'), zone);
    assert.deepEqual(review.actions, [{ status: 'reviewed', note: 'Human note', outcome, at: 1000 }]);
    assert.deepEqual(parseEvents(JSON.parse(data.get(key))).value, store.getEvents());
  }
});
test('outcome is not resolution: confirmation is required and unable to verify must be superseded', () => {
  assert.equal(act('resolved', { confirmed: true }), false);
  assert.equal(act('reviewed', { outcome: 'unable-to-verify' }), true);
  assert.equal(act('resolved', { confirmed: true }), false);
  assert.equal(act('reviewed', { outcome: 'assistance-needed' }, 'risk', 1200), true);
  assert.equal(current().review.status, 'reviewed');
  assert.equal(act('resolved'), false);
  assert.equal(act('resolved', { confirmed: true }, 'risk', 1400), true);
  assert.equal(reviewOutcome(current().review), 'assistance-needed');
  assert.equal(current().review.actions.at(-1).confirmed, true);
  assert.equal(act('reviewed', { outcome: 'no-assistance-needed' }), false);
});
test('legacy resolved/dismissed zone records, risk and AI rows load and export without migration or invented outcomes', () => {
  const rows = [risk, ai, ...['resolved', 'dismissed'].map((status) => ({ ...zone, id: status,
    review: { status, actions: [...(status === 'resolved' ? [{ status: 'reviewed', at: 600, note: 'Old review' }] : []), { status, at: 700, note: 'Old action' }] },
  }))];
  writeRows(rows);
  const original = data.get(key);
  assert.deepEqual(store.getEvents(), rows);
  assert.equal(data.get(key), original);
  for (const row of rows.slice(2)) {
    assert.equal(reviewOutcome(row.review), undefined);
    assert.equal(act('reviewed', {}, row.id), false);
  }
  assert.equal(act('reviewed', {}, 'ai'), false);
  assert.equal(act('reviewed'), true);
  assert.deepEqual(JSON.parse(data.get(key)).slice(1), rows.slice(1));
});
test('notes and outcomes can be appended to reviewed records; timestamps cannot go backwards', () => {
  assert.equal(act('reviewed', { outcome: 'unable-to-verify' }), true);
  assert.equal(act('reviewed', {}, 'risk', 10, 'Follow-up <note>'), true);
  assert.equal(current().review.actions.at(-1).at, 1000);
  assert.equal(current().review.actions.at(-1).note, 'Follow-up <note>');
  assert.equal(reviewOutcome(current().review), 'unable-to-verify');
});
test('zone outcomes preserve all session, temporary person, source, observation and timing fields', () => {
  assert.equal(act('reviewed', { outcome: 'assistance-needed' }, 'zone', 800), true);
  assert.equal(act('resolved', { confirmed: true }, 'zone', 900), true);
  const { review, ...evidence } = current('zone');
  const { review: originalReview, ...originalEvidence } = zone;
  assert.deepEqual(evidence, originalEvidence);
  assert.equal(reviewOutcome(review), 'assistance-needed');
  assert.equal(review.actions.length, 2);
});
test('stale tab revisions cannot append or resolve against a changed review, but retain other-tab rows', () => {
  const stale = current().review ?? null;
  assert.equal(act('reviewed', { expectedReview: stale, outcome: 'assistance-needed' }), true);
  const original = data.get(key);
  assert.equal(act('reviewed', { expectedReview: stale, outcome: 'no-assistance-needed' }), false);
  assert.equal(act('resolved', { expectedReview: stale, confirmed: true }), false);
  assert.equal(data.get(key), original);
  const fresh = current().review;
  writeRows([...JSON.parse(original), { ...risk, id: 'other-tab' }]);
  assert.equal(act('reviewed', { expectedReview: fresh }), true);
  assert.ok(current('other-tab'));
});
test('read/write failures and damaged history preserve original storage and permit explicit retry only', () => {
  const original = data.get(key);
  failWrite = true;
  assert.equal(act('reviewed', { outcome: 'assistance-needed' }), false);
  assert.equal(data.get(key), original);
  failWrite = false; failRead = true;
  assert.equal(act('reviewed'), false);
  assert.equal(data.get(key), original);
  failRead = false;
  writeRows([risk, { invalid: true }]);
  const damaged = data.get(key);
  assert.equal(act('reviewed'), false);
  assert.equal(data.get(key), damaged);
  assert.equal(store.getOriginalStorage('events'), damaged);
  data.set(key, original); // Explicit external restoration.
  assert.equal(act('reviewed', { outcome: 'no-assistance-needed' }), true);
});
test('review never applies retention, even with damaged preferences or more rows than the limit', () => {
  writeRows(Array.from({ length: 310 }, (_, i) => ({ ...risk, id: i ? `r${i}` : 'risk' })));
  data.set(store.STORAGE_KEYS.prefs, '{"maxEvents":-1}');
  assert.equal(act('reviewed'), true);
  assert.equal(store.getEvents().length, 310);
});
test('invalid outcomes, transitions, timestamps, confirmation and oversized payloads fail validation without recovery writes', () => {
  const action = { status: 'reviewed', at: 1000, note: '' };
  for (const review of [
    { status: 'reviewed', actions: [{ ...action, outcome: 'injured' }] },
    { status: 'reviewed', actions: [{ ...action, outcome: null }] },
    { status: 'reviewed', actions: [{ ...action, confirmed: true }] },
    { status: 'reviewed', actions: [{ ...action, note: 'x'.repeat(1001) }] },
    { status: 'reviewed', actions: [{ ...action, at: 499 }] },
    { status: 'open', actions: [action] },
    { status: 'resolved', actions: [action, { ...action, status: 'resolved', at: 1200, outcome: 'no-assistance-needed' }] },
    { status: 'resolved', actions: [{ ...action, outcome: 'unable-to-verify' }, { ...action, status: 'resolved', confirmed: true }] },
    { status: 'reviewed', actions: Array(MAX_REVIEW_ACTIONS + 1).fill(action) },
  ]) assert.equal(validEvent({ ...risk, review }), false);
  assert.equal(act('reviewed', { outcome: 'injured' }), false);
  assert.equal(act('reviewed', {}, 'risk', NaN), false);
  assert.equal(act('reviewed', {}, 'risk', 1000, 'x'.repeat(1001)), false);
  assert.equal(validEvent({ ...ai, review: { status: 'open', actions: [] } }), false);
});
test('summaries remain zone/source/session scoped and missing review is not an invented check', () => {
  writeRows([risk, ai, { ...zone, review: undefined }]);
  assert.equal(summarizeZoneSessions(store.getEvents())[0].notRecorded, 1);
  assert.equal(act('reviewed', { outcome: 'unable-to-verify' }, 'zone'), true);
  const s = summarizeZoneSessions(store.getEvents())[0];
  assert.equal(s.total, 1); assert.equal(s.reviewed, 1); assert.equal(s.resolved, 0);
});
