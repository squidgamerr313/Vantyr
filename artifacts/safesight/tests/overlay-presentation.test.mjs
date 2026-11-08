import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawOverlay, simulateFrame, DEMO_W, DEMO_H } from '../src/lib/overlay.ts';

function canvas() {
  const text = [], rects = [];
  return {
    text, rects, clearRect() {}, setLineDash() {}, beginPath() {}, stroke() {}, fill() {},
    roundRect(...rect) { rects.push(rect); },
    measureText(s) { return { width: s.length * 7 }; },
    fillText(s) { text.push(s); }, moveTo() {}, lineTo() {}, arc() {},
  };
}
test('schematic overlays label scripted boxes without manufacturing confidence readouts', () => {
  const frame = simulateFrame(4200);
  const before = structuredClone(frame);
  const ctx = canvas();
  drawOverlay(ctx, frame, DEMO_W, DEMO_H, { boxes: true, pose: true, minConf: .3, simulated: true });
  assert.equal(ctx.text.length, 3);
  assert.ok(ctx.text.every(t => t.startsWith('SIM ') && t.endsWith('/ scripted')));
  assert.ok(ctx.text.every(t => !t.includes('%')));
  assert.deepEqual(frame, before, 'presentation must not change simulation geometry or evidence');
});
test('real camera overlays retain actual model confidence labels and original box geometry', () => {
  const frame = simulateFrame(4200), ctx = canvas();
  drawOverlay(ctx, frame, DEMO_W, DEMO_H, { boxes: true, pose: false, minConf: .3 });
  assert.match(ctx.text[0], /^person \d+\.\d%$/);
  assert.deepEqual(ctx.rects[0].slice(0, 4), frame.detections[0].box);
});
