/** Combined production-module regression with numeric observations, NOT camera/model accuracy.
 * Mirrors Dashboard admission/reset/persistence wiring without claiming to mount its React loop.
 * Browser and physical-device verification have separate evidence requirements.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMonitoringHealth } from '../src/lib/monitoring-health.ts';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { createContextDecisionLayer } from '../src/lib/context-decision.ts';
import { individualCheckDecisions } from '../src/lib/context-check-records.ts';
import { createZoneMonitor } from '../src/lib/zone-monitor.ts';
import { presentCurrentObservation, presentSavedObservation } from '../src/lib/observation-presentation.ts';
import { candidateAdmission, CANDIDATES } from '../src/lib/candidate-admission.ts';
import { peopleFrame, person } from './fixtures/people.mjs';

const data = new Map();
let failWrite = false;
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => { if (failWrite) throw Error('Injected quota failure'); data.set(key, String(value)); },
};
globalThis.window = new EventTarget();
const store = await import('../src/lib/store.ts');
const outbox = await import('../src/lib/check-outbox.ts');
const horizontal = (x = .3) => person(x, { angle: 90 });
const zone = { id: 'bench', name: 'Numeric bench', rect: [0, 0, 1, 1], dwellSec: 4 };

beforeEach(() => {
  failWrite = false;
  // Explicitly drain the tab outbox; tests never touch browser/creator storage.
  for (const pending of outbox.getPendingChecks()) assert.ok(outbox.retryCheck(pending.id));
  data.clear(); store.getEvents(); store.getPrefs();
});

function pipeline() {
  const assessor = createRiskAssessor(), layer = createContextDecisionLayer(), zones = createZoneMonitor();
  let session = 'numeric-1', serial = 1, started = 0, admitted = 0, rejected = 0;
  const reset = () => { assessor.reset(); layer.reset(); zones.reset(); };
  const monitor = createMonitoringHealth({ publish() {}, invalidate: reset });
  const transition = (phase, now) => {
    // Production teardown resets temporal modules in addition to invalidating health tickets.
    monitor.enter(phase, now); reset();
  };
  transition('waiting', 0);
  return {
    monitor, transition,
    restart(now) { transition('stopped', now); session = `numeric-${++serial}`; started = now; transition('waiting', now); },
    counts: () => ({ admitted, rejected }),
    prepare(time, now = time) {
      monitor.sample(true, time / 1000, now);
      return monitor.beginInference(time / 1000, now);
    },
    frame(time, people = [horizontal()], options = {}) {
      const now = options.now ?? time;
      const ticket = options.ticket ?? this.prepare(time, now);
      if (!monitor.complete(ticket, time, options.end ?? now + 1)) { rejected++; return null; }
      admitted++;
      const result = peopleFrame(people, { time, noPose: options.noPose ?? [] });
      result.detections.push(...(options.objects ?? []));
      const a = assessor.assess(result, 1000, 600, now, { source: 'live' });
      const progress = zones.tick({ zone, source: 'live', sessionId: session, sessionStartedAt: started,
        persons: a.tracking.persons, frameTimeMs: time, now });
      const decision = layer.decide({ result, tracking: a.tracking, width: 1000, height: 600, now,
        source: 'live', sessionId: session, zone: { config: zone, progress },
        blockedReason: outbox.getPendingChecks().length + a.tracking.persons.length > 50 ? 'Retry capacity exhausted' : undefined });
      if (store.getPrefs().logThreshold !== 'high') {
        for (const d of individualCheckDecisions(decision)) {
          outbox.saveCheck({ id: crypto.randomUUID(), ts: 100000 + now, source: 'live', kind: 'risk',
            level: 'uncertain', score: null, detections: result.detections.length,
            evidence: [...d.facts.map(f => f.description), ...d.reasons], decision: d, review: { status: 'open', actions: [] } });
        }
      }
      return { ...a, decision, progress };
    },
  };
}

test('combined fresh observation → failed save → explicit retry → review → recovery preserves evidence and owned episodes', () => {
  const p = pipeline();
  p.frame(0); p.frame(1000);
  failWrite = true;
  const a = p.frame(2000);
  assert.equal(p.monitor.read().phase, 'fresh');
  assert.equal(presentCurrentObservation(a, 'live').headline, 'Human check suggested');
  assert.equal(store.getEvents().length, 0);
  const pending = outbox.getPendingChecks()[0];
  assert.ok(pending); assert.equal(pending.score, null);
  p.frame(3000); p.frame(4000);
  assert.equal(outbox.getPendingChecks().length, 1, 'no recurring cooldown duplicates while unsaved');
  assert.equal(outbox.retryCheck(pending.id), false);
  failWrite = false;
  assert.ok(outbox.retryCheck(pending.id));
  assert.ok(outbox.saveCheck(pending), 'a repeated saved episode returns success without creating a second row');
  assert.equal(store.getEvents().length, 1);
  const saved = store.getEvents()[0], originalDecision = JSON.stringify(saved.decision);
  assert.equal(presentSavedObservation(saved).headline, 'Human check suggested');
  assert.ok(store.reviewEvent(saved.id, 'reviewed', 'Not verifiable', 110000, { outcome: 'unable-to-verify' }));
  assert.equal(store.reviewEvent(saved.id, 'resolved', '', 111000, { confirmed: true }), false);
  assert.ok(store.reviewEvent(saved.id, 'reviewed', 'Human follow-up', 112000, { outcome: 'assistance-needed' }));
  assert.ok(store.reviewEvent(saved.id, 'resolved', 'Explicitly confirmed', 113000, { confirmed: true }));
  p.frame(5000, []); // departure is not recovery and cannot mutate human outcomes
  const reviewed = store.getEvents()[0];
  assert.equal(reviewed.review.status, 'resolved');
  assert.equal(JSON.stringify(reviewed.decision), originalDecision);
  const raw = data.get(store.STORAGE_KEYS.events);
  data.set(store.STORAGE_KEYS.events, '[{"damaged":true}]');
  p.restart(6000); p.frame(6000); p.frame(7000); p.frame(8000);
  assert.equal(data.get(store.STORAGE_KEYS.events), '[{"damaged":true}]', 'no salvage write');
  assert.equal(outbox.getPendingChecks().length, 1);
  data.set(store.STORAGE_KEYS.events, raw); // explicit restoration, not silent migration
  assert.ok(outbox.retryCheck(outbox.getPendingChecks()[0].id));
  assert.equal(store.getEvents().length, 2);
  assert.deepEqual(JSON.parse(data.get(store.STORAGE_KEYS.events)).find(e => e.id === saved.id), reviewed);
});

test('combined overload/freeze invalidates posture and zone timers; new decoded inference is required before requalification', () => {
  const p = pipeline();
  p.frame(0); p.frame(1000);
  const late = p.prepare(1500);
  p.monitor.sample(true, 3.9, 3900); // advancing video does not freshen the old inference
  assert.equal(p.frame(1500, undefined, { ticket: late, now: 1500, end: 4000 }), null);
  assert.equal(p.monitor.read().phase, 'stale');
  assert.equal(store.getEvents().length, 0);
  const first = p.frame(4100);
  assert.equal(first.tracking.persons[0].horizontalMs, 0);
  assert.deepEqual(first.decision.episodes, []);
  assert.equal(first.progress.triggers.length, 0);
  p.frame(5100); p.frame(6100);
  assert.equal(store.getEvents().length, 1);
  p.monitor.sample(true, 6.1, 8600); // same decoded frame at the strict age bound
  assert.equal(p.monitor.read().phase, 'stale');
  const resumed = p.frame(8700);
  assert.equal(resumed.tracking.persons[0].horizontalMs, 0);
  assert.deepEqual(resumed.decision.episodes, []);
  assert.equal(resumed.progress.triggers.length, 0, 'no inherited four-second zone dwell');
  assert.deepEqual(p.counts(), { admitted: 6, rejected: 1 });
});

test('combined interruption/source/restart rejects pending work and never carries posture checks across sessions', () => {
  for (const phase of ['stopped', 'simulation', 'requesting', 'loading', 'interrupted', 'error']) {
    const p = pipeline();
    p.frame(0); p.frame(1000);
    const old = p.prepare(1500);
    p.transition(phase, 1600);
    assert.equal(p.frame(1500, undefined, { ticket: old, now: 1700 }), null);
    assert.equal(p.monitor.read().phase, phase);
    p.restart(1800);
    assert.deepEqual(p.frame(2000).decision.episodes, []);
    assert.deepEqual(p.frame(3000).decision.episodes, []);
    assert.equal(p.frame(4000).decision.episodes.length, 1);
  }
});

test('combined ambiguity and shared image translation withhold temporal checks instead of claiming camera compensation', () => {
  for (const interrupt of [
    p => p.frame(1500, [horizontal(), person(.35)]),
    p => p.frame(1500, [horizontal()], { noPose: [0] }),
    p => p.frame(1500, []),
  ]) {
    const p = pipeline(); p.frame(0); p.frame(1000); interrupt(p);
    assert.deepEqual(p.frame(2000).decision.episodes, []);
    assert.deepEqual(p.frame(3000).decision.episodes, []);
  }
  const p = pipeline();
  p.frame(0, [horizontal(.2), horizontal(.7)]);
  const moved = p.frame(1000, [horizontal(.25), horizontal(.75)]);
  assert.ok(moved.tracking.persons.every(person => person.status === 'uncertain' && person.horizontalMs === 0));
  assert.deepEqual(moved.decision.episodes, []);
  assert.equal(moved.progress.triggers.length, 0);
  assert.deepEqual(p.frame(2000, [horizontal(.25), horizontal(.75)]).decision.episodes, []);
  assert.deepEqual(p.frame(3000, [horizontal(.25), horizontal(.75)]).decision.episodes, []);
});

test('combined capability and preference boundaries keep fresh empty/object-only scenes distinct from unsupported actions', () => {
  for (const candidate of [...CANDIDATES, { id: 'unregistered' }])
    assert.equal(candidateAdmission(candidate.id).enabled, false);
  for (const [people, options] of [[[], {}], [[person(.3)], { noPose: [0] }]]) {
    const p = pipeline(), a = p.frame(0, people, options);
    assert.equal(p.monitor.read().phase, 'fresh');
    assert.equal(a.tracking.quality, 'limited');
    assert.equal(a.decision.fallState, 'unavailable');
    assert.deepEqual(a.decision.episodes, []);
  }
  const context = pipeline();
  const crowd = [person(.1), person(.35), person(.6), person(.85)];
  const objects = [{ id: 'knife', label: 'knife', confidence: .9, box: [300, 200, 40, 30] }];
  for (const t of [0, 1000, 2000, 3000]) {
    const a = context.frame(t, crowd, { objects });
    assert.ok(a.score > 0, 'legacy diagnostic score is not the logging authority');
    assert.equal(a.decision.priority, 'context');
    assert.deepEqual(a.decision.episodes, []);
    assert.equal(a.decision.facts.find(f => f.kind === 'tool-proximity').owner, null);
  }
  assert.equal(store.getEvents().length, 0);
  assert.ok(store.setPrefs({ logThreshold: 'high' }));
  const p = pipeline();
  p.frame(0); p.frame(1000);
  assert.equal(p.frame(2000).decision.priority, 'check');
  assert.equal(store.getEvents().length, 0, 'high-only preference withholds descriptive check history');
  assert.ok(store.setPrefs({ logThreshold: 'moderate' }));
});

test('combined retry-capacity exhaustion withholds new temporal checks and resumes only after explicit saving', () => {
  const p = pipeline();
  failWrite = true;
  for (let i = 0; i < 50; i++) {
    const start = i * 4000;
    p.restart(start); p.frame(start); p.frame(start + 1000); p.frame(start + 2000);
  }
  assert.equal(outbox.getPendingChecks().length, 50);
  const pendingIds = outbox.getPendingChecks().map(e => e.id);
  p.restart(200000);
  for (const t of [200000, 201000, 202000]) {
    const a = p.frame(t);
    assert.equal(a.decision.freshness, 'unavailable');
    assert.deepEqual(a.decision.episodes, []);
  }
  assert.deepEqual(outbox.getPendingChecks().map(e => e.id), pendingIds, 'no eviction or pretend-save');
  failWrite = false;
  for (const id of pendingIds) assert.ok(outbox.retryCheck(id));
  assert.equal(outbox.getPendingChecks().length, 0);
  assert.equal(store.getEvents().length, 50);
  assert.deepEqual(p.frame(203000).decision.episodes, [], 'saving does not restore old temporal support');
  p.frame(204000);
  assert.equal(p.frame(205000).decision.episodes.length, 1);
  assert.equal(store.getEvents().length, 51);
});
