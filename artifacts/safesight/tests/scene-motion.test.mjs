import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateSceneMotion, SCENE_WIDTH as W, SCENE_HEIGHT as H } from '../src/lib/scene-motion.ts';
import { createPersonTracker } from '../src/lib/person-tracking.ts';
import { peopleFrame, person } from './fixtures/people.mjs';

function texture() {
  return Uint8Array.from({ length: W * H }, (_, i) => {
    let v = Math.imul(i + 17, 2654435761); v ^= v >>> 13;
    return v & 255;
  });
}
function shift(gray, dx, dy) {
  return Uint8Array.from({ length: W * H }, (_, i) => {
    const x = i % W - dx, y = Math.floor(i / W) - dy;
    return x >= 0 && x < W && y >= 0 && y < H ? gray[y * W + x] : 0;
  });
}
const sample = (gray, time = 125, excluded = []) => ({ gray, time, excluded });
test('independent textured background distinguishes translation from a stable view', () => {
  const gray = texture(), first = sample(gray, 0);
  assert.equal(estimateSceneMotion(first, sample(gray)).status, 'stable');
  assert.equal(estimateSceneMotion(first, sample(shift(gray, 2, 1))).status, 'moving');
  assert.equal(estimateSceneMotion(first, sample(shift(gray, -3, -2))).status, 'moving');
});
test('missing, reversed, gapped, textureless, repetitive and crowded backgrounds are unknown', () => {
  const gray = texture(), first = sample(gray, 0);
  for (const current of [sample(gray, 0), sample(gray, -1), sample(gray, 501), sample(gray, NaN),
    sample(new Uint8Array(10)), sample(gray, 125, [[0, 0, 1, 1]])])
    assert.equal(estimateSceneMotion(first, current).status, 'unknown');
  assert.equal(estimateSceneMotion(null, sample(gray)).status, 'unknown');
  const flat = new Uint8Array(W * H).fill(100);
  const stripes = Uint8Array.from(flat, (_, i) => i % 4 < 2 ? 0 : 255);
  assert.equal(estimateSceneMotion(sample(flat, 0), sample(flat)).status, 'unknown');
  assert.equal(estimateSceneMotion(sample(stripes, 0), sample(stripes)).status, 'unknown');
});
test('both frames exclude people; person-only movement cannot become scene evidence', () => {
  const gray = new Uint8Array(W * H).fill(100), patch = texture();
  for (let y = 10; y < 42; y++) for (let x = 20; x < 76; x++) gray[y * W + x] = patch[y * W + x];
  const excluded = [[.15, .08, .7, .85]];
  assert.equal(estimateSceneMotion(sample(gray, 0, excluded), sample(gray)).status, 'unknown');
  assert.equal(estimateSceneMotion(sample(gray, 0), sample(gray, 125, excluded)).status, 'unknown');
});
test('spatially inconsistent background motion and search-limit movement cannot be compensated', () => {
  const gray = texture(), a = shift(gray, 2, 0), b = shift(gray, -2, 0);
  const disagreement = Uint8Array.from(a, (v, i) => i % W < W / 2 ? v : b[i]);
  assert.equal(estimateSceneMotion(sample(gray, 0), sample(disagreement)).status, 'unknown');
  assert.equal(estimateSceneMotion(sample(gray, 0), sample(shift(gray, 6, 0))).status, 'unknown');
});
for (const status of ['moving', 'unknown']) test(`${status} independent scene evidence restarts all temporal evidence`, () => {
  const tracker = createPersonTracker();
  const frame = () => peopleFrame([person(.3, { angle: 90 })]);
  tracker.update(frame(), 1000, 600, 0);
  tracker.update(frame(), 1000, 600, 1000);
  const limited = tracker.update({ ...frame(), sceneMotion: { status, reason: 'Background test', support: 0 } }, 1000, 600, 2000);
  assert.equal(limited.persons[0].horizontalMs, 0);
  assert.deepEqual(limited.persons[0].observations, []);
  assert.equal(limited.persons[0].status, 'uncertain');
  const recovered = tracker.update({ ...frame(), sceneMotion: { status: 'stable', reason: 'Background test', support: 12 } }, 1000, 600, 2200);
  assert.equal(recovered.persons[0].horizontalMs, 0);
});
test('stable independent background distinguishes coordinated person motion from scene motion', () => {
  const tracker = createPersonTracker();
  const sceneMotion = { status: 'stable', reason: 'Background test', support: 12 };
  tracker.update({ ...peopleFrame([person(.2), person(.7)]), sceneMotion }, 1000, 600, 0);
  const next = tracker.update({ ...peopleFrame([person(.25), person(.75)]), sceneMotion }, 1000, 600, 125);
  assert.ok(next.persons.every(p => p.status === 'tracked'));
});
