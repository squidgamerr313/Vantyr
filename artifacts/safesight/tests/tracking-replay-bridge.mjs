// Offline only. Raw pixels, detections and poses remain in this process/pipe.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import * as coco from '@tensorflow-models/coco-ssd';
import { createPersonTracker } from '../src/lib/person-tracking.ts';
import { observePeople } from '../src/lib/person-geometry.ts';
import { estimateSceneMotion } from '../src/lib/scene-motion.ts';
await tf.setBackend('cpu');
// IOHandler reads only hash-checked local model assets. No fetch fallback.
const dir = new URL('../../../generated-artifacts/tracking-evaluation/coco/', import.meta.url);
const receipt = JSON.parse(readFileSync(new URL('receipt.json', dir)));
const checked = (name) => {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Unsafe model member');
  const bytes = readFileSync(new URL(name, dir));
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.files[name]) throw new Error('Changed COCO model');
  return bytes;
};
const model = JSON.parse(checked('model.json'));
const bytes = Buffer.concat(model.weightsManifest.flatMap(g => g.paths.map(checked)));
const detector = await coco.load({ base: 'lite_mobilenet_v2', modelUrl: { load: async () => ({
  modelTopology: model.modelTopology, weightSpecs: model.weightsManifest.flatMap(g => g.weights),
  weightData: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
}) } });
const baseline = createPersonTracker(), candidate = createPersonTracker(), upscale = createPersonTracker();
let previous = null;
try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const m = JSON.parse(line);
    if (m.reset) {
      previous = null; baseline.reset(); candidate.reset(); upscale.reset();
      console.log(JSON.stringify({ reset: true })); continue;
    }
    const tensor = tf.tensor3d(new Uint8Array(Buffer.from(m.rgb, 'base64')), [m.height, m.width, 3], 'int32');
    let predictions;
    try { predictions = await detector.detect(tensor, 20, .2); } finally { tensor.dispose(); }
    const detections = predictions.map((p, i) => ({ id: `d${i}`, label: p.class, confidence: p.score, box: p.bbox }));
    const frame = { detections, landmarks: m.landmarks, latency: 0, frameTimeMs: m.timeMs };
    const observations = observePeople(frame, m.width, m.height);
    const current = { gray: new Uint8Array(Buffer.from(m.gray, 'base64')), excluded: observations.map(o => o.box), time: m.timeMs };
    const scene = estimateSceneMotion(previous, current); previous = current;
    const a = baseline.update(frame, m.width, m.height, m.timeMs);
    // Same thresholds/association; independent scene gating is the only candidate change.
    const b = candidate.update({ ...frame, sceneMotion: scene }, m.width, m.height, m.timeMs);
    const c = upscale.update({ ...frame, landmarks: m.upscaledLandmarks }, m.width, m.height, m.timeMs);
    console.log(JSON.stringify({ detections, observations, baseline: a, candidate: b, upscale: c, scene }));
  }
} finally { detector.dispose(); }
