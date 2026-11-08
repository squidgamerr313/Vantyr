// Synthetic engineering contracts, NOT action/identity accuracy evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { createInteractionPairs, visibleJoint, PAIR_CONTRACT } from "../src/lib/interaction-pairs.ts";
function person(x) {
  const p = Array.from({ length: 33 }, () => ({ x, y: .4, visibility: 0 }));
  for (const [j, dx, y] of [[11, -.035, .35], [12, .035, .35], [13, -.05, .45],
    [14, .05, .45], [15, -.065, .55], [16, .065, .55]]) p[j] = { x: x + dx, y, visibility: .95 };
  return p;
}
function fixture(n = 3) {
  return Array.from({ length: 16 }, (_, i) => ({ timeMs: i * 125, width: 720, height: 480,
    landmarks: Array.from({ length: n }, (_, j) => person(.2 + .3 * j)) }));
}
function run(frames) {
  const builder = createInteractionPairs();
  return frames.map(f => builder.push(f));
}
test("three people create three separately associated finite pair candidates", () => {
  const result = run(fixture()).at(-1);
  assert.equal(result.windows.length, 3);
  for (const w of result.windows) {
    assert.equal(w.contract, PAIR_CONTRACT);
    assert.equal(w.features.length, 36);
    assert.ok(w.features.every(c => c.length === 16 && c.every(Number.isFinite)));
    assert.deepEqual(w.observedFrames, [16, 16]);
    assert.ok(w.box[0] >= 0 && w.box[2] <= 720);
  }
});
test("reordering detections preserves candidate features and IDs", () => {
  const frames = fixture(), expected = run(frames).at(-1);
  for (let i = 1; i < frames.length; i += 2) frames[i].landmarks.reverse();
  assert.deepEqual(run(frames).at(-1), expected);
});
test("short person absence masks every joint and never interpolates XY", () => {
  const frames = fixture(2);
  frames[7].landmarks.pop(); frames[8].landmarks.pop();
  const w = run(frames).at(-1).windows[0];
  assert.ok(w);
  assert.deepEqual(w.observedFrames, [16, 14]);
  for (let c = 18; c < 36; c++) for (const t of [7, 8]) assert.equal(w.features[c][t], 0);
});
test("long absence never bridges an identity gap", () => {
  const frames = fixture(2);
  for (const t of [5, 6, 7, 8]) frames[t].landmarks.pop();
  assert.equal(run(frames).at(-1).windows.length, 0);
});
test("ambiguous crossing clears history instead of guessing identity", () => {
  const frames = fixture(2);
  for (const frame of frames) frame.landmarks = [person(.3), person(.4)];
  frames[7].landmarks = [person(.35), person(.35)];
  const result = run(frames);
  assert.match(result[7].reason, /Ambiguous/);
  assert.equal(result.at(-1).windows.length, 0);
});
test("missing wrists remain masked; off-image and nonfinite joints are not observed", () => {
  const frames = fixture(2);
  frames[5].landmarks[0][15].x = -0.1;
  frames[5].landmarks[0][16].x = 1.1;
  const w = run(frames).at(-1).windows[0];
  assert.equal(w.features[14][5], 0);
  assert.equal(w.features[17][5], 0);
  for (const x of [-.01, 1.01, NaN, Infinity]) assert.equal(visibleJoint({ x, y: .5, visibility: 1 }), false);
});
test("changed geometry, bad timestamps and explicit reset erase pair history", () => {
  for (const mutate of [
    f => { f.timeMs = 0; }, f => { f.timeMs = NaN; }, f => { f.width = 640; },
    f => { f.timeMs += 500; }, f => { f.landmarks.push(person(.9), person(.95)); },
  ]) {
    const frames = fixture(2); mutate(frames[8]);
    assert.equal(run(frames).at(-1).windows.length, 0);
  }
  const builder = createInteractionPairs();
  for (const f of fixture(2)) builder.push(f);
  builder.reset();
  assert.equal(builder.push(fixture(2)[0]).windows.length, 0);
});
test("no current observation means no pair candidate", () => {
  const frames = fixture(2); frames[15].landmarks.pop();
  assert.equal(run(frames).at(-1).windows.length, 0);
});
