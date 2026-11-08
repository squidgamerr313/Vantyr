import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { createContextDecisionLayer } from '../src/lib/context-decision.ts';
import { person, peopleFrame } from './fixtures/people.mjs';
import { individualCheckDecisions } from '../src/lib/context-check-records.ts';
import { presentSavedObservation } from '../src/lib/observation-presentation.ts';
import { validEvent } from '../src/lib/storage-validation.ts';
const data = new Map();
let blocked = false;
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => { if (blocked) throw new Error('blocked'); data.set(key, value); },
};
globalThis.window = new EventTarget();
const store = await import('../src/lib/store.ts');
const outbox = await import('../src/lib/check-outbox.ts');
function event(sessionId = 'session-a') {
  const assessor = createRiskAssessor(), layer = createContextDecisionLayer();
  let decision;
  for (const t of [0, 1000, 2000]) {
    const result = peopleFrame([person(.3, { angle: 90 })], { time: t });
    const a = assessor.assess(result, 1000, 600, t);
    decision = layer.decide({ result, tracking: a.tracking, width: 1000, height: 600, now: t, source: 'live', sessionId });
  }
  return { id: crypto.randomUUID(), ts: 10000, source: 'live', kind: 'risk', level: 'uncertain', score: null,
    evidence: decision.reasons, detections: 1, decision, review: { status: 'open', actions: [] } };
}
beforeEach(() => { blocked = false; data.clear(); store.getEvents(); store.getPrefs(); });
test('new context events are deduplicated by owned episode, not by risk score, and remain valid across reload-style reads', () => {
  const first = store.addEvent(event());
  assert.ok(first);
  assert.equal(store.addEvent(event()).id, first.id);
  assert.equal(store.getEvents().length, 1);
  assert.notEqual(store.addEvent(event('other-session')).id, first.id);
  assert.equal(store.getEvents().length, 2);
});
test('review outcomes and resolution are explicit human records without changing sensing metadata', () => {
  const saved = store.addEvent(event()), original = JSON.stringify(saved.decision);
  assert.ok(store.reviewEvent(saved.id, 'reviewed', 'Cannot see person', 11000, { outcome: 'unable-to-verify' }));
  assert.equal(store.reviewEvent(saved.id, 'resolved', '', 12000, { confirmed: true }), false);
  assert.ok(store.reviewEvent(saved.id, 'reviewed', 'Needs help', 12000, { outcome: 'assistance-needed' }));
  assert.ok(store.reviewEvent(saved.id, 'resolved', 'Follow-up handled', 13000, { confirmed: true }));
  const reloaded = store.getEvents()[0];
  assert.equal(JSON.stringify(reloaded.decision), original);
  assert.equal(reloaded.review.actions.length, 3);
  assert.equal(reloaded.review.actions[1].outcome, 'assistance-needed');
  assert.equal(store.addEvent(event()).review.status, 'resolved'); // sensing never reopens human review
});
test('failed saves remain retryable across navigation without rewriting old/damaged data', () => {
  const legacy = store.addEvent({ source: 'live', kind: 'risk', score: 72, level: 'high', evidence: ['Original'], detections: 1 });
  const original = JSON.stringify(legacy);
  const e = event();
  blocked = true;
  assert.equal(outbox.saveCheck(e), false);
  assert.equal(outbox.getPendingChecks().length, 1);
  assert.equal(outbox.saveCheck({ ...e, id: 'second-id' }), false);
  assert.equal(outbox.getPendingChecks().length, 1);
  assert.equal(outbox.retryCheck(e.id), false);
  blocked = false;
  assert.equal(outbox.retryCheck(e.id), true);
  assert.equal(outbox.getPendingChecks().length, 0);
  assert.equal(JSON.stringify(store.getEvents().find((v) => v.id === legacy.id)), original);
  data.set(store.STORAGE_KEYS.events, '[{"broken":true}]');
  const corrupt = data.get(store.STORAGE_KEYS.events);
  const later = event('later');
  assert.equal(outbox.saveCheck(later), false);
  assert.equal(data.get(store.STORAGE_KEYS.events), corrupt);
  store.clearEvents();
  assert.equal(outbox.retryCheck(later.id), true);
});

function twoPersonDecisions(staggered = false) {
  const assessor = createRiskAssessor(), layer = createContextDecisionLayer(), decisions = [];
  for (let t = 0; t <= 6000; t += 1000) {
    const people = [person(.25, { angle: 90 }), person(.75, { angle: staggered && t < 3000 ? 0 : 90 })];
    const result = peopleFrame(people, { time: t });
    result.detections.push({ id: 'tool', label: 'knife', confidence: .9, box: [750, 240, 30, 30] });
    const a = assessor.assess(result, 1000, 600, t);
    decisions.push(layer.decide({ result, tracking: a.tracking, width: 1000, height: 600,
      now: t, source: 'live', sessionId: 'two-people' }));
  }
  return decisions;
}
const recordDecision = (d) => ({ id: crypto.randomUUID(), ts: 10000, source: 'live', kind: 'risk',
  level: 'uncertain', score: null, evidence: d.reasons, detections: 3, decision: d, review: { status: 'open', actions: [] } });

for (const staggered of [false, true]) {
  test(`${staggered ? 'staggered' : 'simultaneous'} person checks have distinct labels, subjects and independent review outcomes`, () => {
    const live = twoPersonDecisions(staggered);
    const all = live.flatMap(individualCheckDecisions);
    assert.equal(all.length, 2);
    assert.notEqual(all[0].triggers[0].personId, all[1].triggers[0].personId);
    if (staggered) {
      const second = live.find((d) => d.triggers[0]?.personId === all[1].triggers[0].personId);
      assert.equal(second.facts.filter((f) => f.kind === 'posture' && f.elapsedMs >= 2000).length, 2,
        'first person is still horizontal when the second qualifies');
    } else {
      const simultaneous = live.find((d) => d.triggers.length === 2);
      assert.equal(validEvent(recordDecision(simultaneous)), false, 'merged reviews must never enter storage');
    }
    const records = all.map((d) => store.addEvent(recordDecision(d)));
    assert.equal(store.getEvents().length, 2);
    records.forEach((record, i) => {
      const trigger = all[i].triggers[0];
      const shown = presentSavedObservation(record);
      assert.ok(shown.observed[0].startsWith(`${trigger.label}:`), 'history leads with the triggering person');
      assert.equal(record.decision.episodes[0], trigger.episodeId);
      assert.ok(record.decision.facts.filter((f) => f.kind === 'posture').every((f) => f.owner === trigger.personId));
      assert.ok(record.decision.facts.some((f) => f.kind === 'tool-proximity'), 'scene context retained');
      assert.deepEqual(record.decision.reasons, [trigger.reason]);
    });
    assert.ok(store.reviewEvent(records[0].id, 'reviewed', 'Only the first person checked', 11000, { outcome: 'no-assistance-needed' }));
    assert.ok(store.reviewEvent(records[0].id, 'resolved', 'First person follow-up handled', 12000, { confirmed: true }));
    assert.equal(store.getEvents().find((e) => e.id === records[1].id).review.status, 'open');
    assert.ok(store.reviewEvent(records[1].id, 'reviewed', 'Second person needs help', 13000, { outcome: 'assistance-needed' }));
    assert.equal(store.getEvents().find((e) => e.id === records[0].id).review.status, 'resolved');
    assert.equal(store.getEvents().find((e) => e.id === records[1].id).review.status, 'reviewed');
    assert.equal(store.getEvents().find((e) => e.id === records[1].id).review.actions[0].outcome, 'assistance-needed');
    assert.equal(store.addEvent(recordDecision(all[1])).id, records[1].id, 'retry deduplicates only the second episode');
  });
}
