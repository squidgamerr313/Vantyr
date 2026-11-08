import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolMotionReviewer } from '../src/lib/tool-motion.ts';
import { detailRegions, mapDetailPredictions, mergeDetailPredictions } from '../src/lib/detail-objects.ts';

const detection = (x = 100, label = 'scissors', confidence = .8) => ({ id: 'input-id', label, confidence, box: [x, 100, 100, 100] });
const frame = (reviewer, ms, x = 100, label = 'scissors', key = 'live-one', wall = ms) => reviewer.update([detection(x, label)], 1000, 1000, ms, wall, key);
test('tool labels require distinct elapsed evidence; replay does not create observations', () => {
  const r = createToolMotionReviewer();
  assert.equal(frame(r, 0).items[0].state, 'warming');
  assert.equal(frame(r, 0).items[0].observations, 1);
  frame(r, 250);
  const stable = frame(r, 500).items[0];
  assert.equal(stable.state, 'little-displacement');
  assert.equal(stable.elapsedMs, 500);
  assert.equal(stable.observations, 3);
});
test('ordinary static object jitter is not recognized as movement; no calibrated action/intent label exists', () => {
  const r = createToolMotionReviewer();
  for (let i = 0; i < 8; i++) {
    const e = frame(r, i * 200, 100 + i % 2 * 5);
    assert.equal(e.items[0].directionChanges, 0);
    assert.equal(e.items[0].displacement, 0);
    assert.doesNotMatch(e.items[0].state, /stab|attack|threat/);
  }
});
test('timestamped movement and repeated reversals become visible descriptive evidence', () => {
  const r = createToolMotionReviewer();
  let e;
  [100, 180, 260, 180, 100, 180, 260].forEach((x, i) => { e = frame(r, i * 200, x); });
  assert.equal(e.items[0].state, 'repeated-direction-change');
  assert.equal(e.items[0].directionChanges, 2);
  assert.equal(e.items[0].points.length, 7);
  assert.match(e.note, /not a learned action/);
  assert.match(e.note, /do not trigger automatic responses/);
});
test('remote/toothbrush confusion is visible uncertainty, never corrected into scissors', () => {
  const r = createToolMotionReviewer();
  frame(r, 0); frame(r, 250, 100, 'remote');
  const e = frame(r, 500, 100, 'toothbrush');
  assert.equal(e.items[0].state, 'mixed-labels');
  assert.deepEqual(e.items[0].labels, ['scissors', 'remote', 'toothbrush']);
  assert.equal(e.items[0].label, 'toothbrush');
  const both = r.update([detection(), detection(100, 'remote', .9)], 1000, 1000, 750, 750, 'live-one');
  assert.equal(both.items.length, 1);
  assert.equal(both.items[0].state, 'mixed-labels');
  const remoteOnly = createToolMotionReviewer();
  frame(remoteOnly, 0, 100, 'remote'); frame(remoteOnly, 250, 180, 'remote');
  assert.equal(frame(remoteOnly, 500, 100, 'remote').items[0].state, 'other-object');
});
test('gaps, wall-clock stalls, source/session changes and geometry changes discard temporal continuity', () => {
  for (const mode of ['gap', 'wall', 'session', 'geometry', 'reverse', 'missing']) {
    const r = createToolMotionReviewer(); frame(r, 0); frame(r, 250); frame(r, 500);
    const e = mode === 'gap' ? frame(r, 1500) : mode === 'wall' ? frame(r, 600, 100, 'scissors', 'live-one', 2000)
      : mode === 'session' ? frame(r, 600, 100, 'scissors', 'live-two') : mode === 'reverse' ? frame(r, 200)
      : mode === 'missing' ? r.update([], 1000, 1000, 600, 600, 'live-one')
      : r.update([detection()], 1500, 1000, 600, 600, 'live-one');
    assert.ok(e.items.length === 0 || e.items[0].observations === 1, mode);
    if (mode === 'gap' || mode === 'wall') assert.match(e.note, /Sampling gap/);
  }
});
test('invalid evidence is unavailable; distant reappearance is a new anonymous observation', () => {
  const r = createToolMotionReviewer(); frame(r, 0); frame(r, 250);
  assert.equal(frame(r, 500, 900).items[0].observations, 1);
  assert.equal(frame(r, NaN).status, 'unavailable');
  assert.equal(r.update([detection(-100)], 1000, 1000, 0, 0, 'live').items.length, 0);
});
test('close-up search is bounded, clipped, includes confusable labels and never relabels', () => {
  const proposal = { class: 'remote', score: .9, bbox: [950, 950, 50, 50] };
  const regions = detailRegions([proposal], 1000, 1000, 0);
  assert.equal(regions.length, 2);
  for (const [x, y, w, h] of regions) { assert.ok(x >= 0 && y >= 0 && x + w <= 1000 && y + h <= 1000); }
  assert.notDeepEqual(detailRegions([], 1000, 1000, 0), detailRegions([], 1000, 1000, 1));
  const mapped = mapDetailPredictions([proposal, { class: 'person', score: 1, bbox: [0, 0, 2, 2] },
    { class: 'toothbrush', score: .8, bbox: [-10, 0, 50, 50] }], [100, 200, 1000, 1000]);
  assert.deepEqual(mapped.map(p => p.class), ['remote', 'toothbrush']);
  assert.deepEqual(mapped[1].bbox, [100, 200, 40, 50]);
  const merged = mergeDetailPredictions([proposal, { ...proposal, score: .7 }, { ...proposal, class: 'scissors' }]);
  assert.equal(merged.length, 2); // preserve cross-view disagreement
});
