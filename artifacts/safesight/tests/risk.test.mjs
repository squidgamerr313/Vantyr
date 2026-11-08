import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk, resetRisk } from '../src/lib/risk.ts';
const frame = (detections = [], landmarks = []) => ({ detections, landmarks, latency: 7 });
const object = (label, x = 100, confidence = .9) => ({ id: label + x, label, confidence, box: [x, 100, 100, 200] });
const pose = (visibility = .95) => {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const i of [11, 12]) points[i] = { x: .2, y: .4, visibility };
  for (const i of [23, 24]) points[i] = { x: .6, y: .4, visibility };
  return points;
};
const assess = (f, t = 100) => assessRisk(f, 1000, 600, t);
beforeEach(resetRisk);
test('empty frames are low but never certified safe', () => {
  const r = assess(frame());
  assert.equal(r.score, 0);
  assert.match(r.evidence.join(' '), /does not mean.*safe/i);
});
test('sharp object proximity is moderate and explicitly two-dimensional', () => {
  const r = assess(frame([object('person'), object('knife', 180)]));
  assert.equal(r.score, 48); assert.equal(r.level, 'moderate');
  assert.match(r.evidence.join(' '), /Depth and intent are unknown/);
});
test('distant and low-confidence tools do not trigger proximity', () => {
  assert.equal(assess(frame([object('person'), object('scissors', 850)])).score, 0);
  assert.equal(assess(frame([object('person'), object('knife', 120, .3)])).score, 0);
});
test('four people trigger the documented count rule; three do not', () => {
  assert.equal(assess(frame([0, 1, 2].map((n) => object('person', n * 150)))).score, 0);
  assert.equal(assess(frame([0, 1, 2, 3].map((n) => object('person', n * 150)))).score, 35);
});
test('horizontal posture requires 2 seconds; high requires 5', () => {
  const f = frame([], [pose()]);
  assert.equal(assess(f, 100).score, 0);
  assert.equal(assess(f, 2099).score, 0);
  assert.equal(assess(f, 2100).score, 52);
  assess(f, 4000);
  assert.equal(assess(f, 5100).score, 72);
  assert.equal(assess(f, 5101).level, 'high');
});
test('lost landmarks, tracking gaps, reverse timestamps and session resets break persistence', () => {
  const f = frame([], [pose()]);
  assess(f, 100); assess(frame([], [pose(.2)]), 2100);
  assert.equal(assess(f, 2200).score, 0);
  assert.equal(assess(f, 9000).score, 0);
  assert.equal(assess(f, 10).score, 0);
  resetRisk(); assert.equal(assess(f, 1000).score, 0);
});
