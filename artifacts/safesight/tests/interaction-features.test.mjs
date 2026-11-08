// Synthetic input-contract tests, never recognition/accuracy evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { interactionFeatures, INTERACTION_CONTRACT } from "../src/lib/interaction-features.ts";

function person(x) {
  const p = Array.from({ length: 33 }, () => ({ x, y: .4, visibility: 0 }));
  for (const [j, dx, y] of [[11, -.035, .35], [12, .035, .35], [13, -.05, .45],
    [14, .05, .45], [15, -.065, .55], [16, .065, .55]]) p[j] = { x: x + dx, y, visibility: .95 };
  return p;
}
function fixture() {
  return Array.from({ length: 16 }, (_, i) => ({ timeMs: i * 125, width: 720, height: 480,
    landmarks: [person(.3), person(.7)] }));
}
test("actual RGB input contract has finite 36x16 features", () => {
  const result = interactionFeatures(fixture());
  assert.equal(result.ok, true);
  assert.equal(result.contract, INTERACTION_CONTRACT);
  assert.equal(result.features.length, 36);
  assert.ok(result.features.every(row => row.length === 16 && row.every(Number.isFinite)));
});
test("missing people, additional poses and Kinect-shaped input withhold rather than pad", () => {
  for (const count of [0, 1, 3]) {
    const frames = fixture(); frames[5].landmarks = Array.from({ length: count }, (_, i) => person(.2 + i * .2));
    assert.equal(interactionFeatures(frames).ok, false);
  }
  const frames = fixture(); frames[0].landmarks[0] = frames[0].landmarks[0].slice(0, 15);
  assert.equal(interactionFeatures(frames).ok, false);
});
test("timestamps, cadence, geometry and missing shoulders fail closed", () => {
  const mutations = [
    f => { f[8].timeMs = f[7].timeMs; },
    f => { f[8].timeMs = NaN; },
    f => { f[8].width = 640; },
    f => { f[8].landmarks[0][11].visibility = 0; },
    f => { f[8].landmarks[0][11].x = NaN; },
  ];
  for (const mutate of mutations) { const frames = fixture(); mutate(frames); assert.equal(interactionFeatures(frames).ok, false); }
});
test("one missing wrist is explicitly masked, not treated as an observed zero", () => {
  const frames = fixture(); frames[0].landmarks[0][15].visibility = 0;
  const result = interactionFeatures(frames);
  assert.equal(result.ok, true);
  assert.equal(result.features[12][0], 0);
  assert.equal(result.features[13][0], 0);
  assert.equal(result.features[14][0], 0);
  assert.equal(result.features[17][0], 1);
});
test("frame detector ordering does not switch actor identities", () => {
  const frames = fixture(), expected = interactionFeatures(frames);
  for (let i = 1; i < frames.length; i += 2) frames[i].landmarks.reverse();
  assert.deepEqual(interactionFeatures(frames), expected);
});
test("ambiguous crossing never invents actor continuity", () => {
  const frames = fixture(); frames[8].landmarks = [person(.5), person(.5)];
  assert.match(interactionFeatures(frames).reason, /Ambiguous/);
});
test("shared image translation and pixel scaling preserve body-relative features", () => {
  const frames = fixture(), a = interactionFeatures(frames);
  for (const f of frames) {
    f.width *= 2; f.height *= 2;
    for (const p of f.landmarks) for (const j of p) { j.x += .02; j.y += .01; }
  }
  const b = interactionFeatures(frames);
  assert.equal(b.ok, true);
  a.features.forEach((row, c) => row.forEach((n, t) => assert.ok(Math.abs(n - b.features[c][t]) < 1e-8)));
});
