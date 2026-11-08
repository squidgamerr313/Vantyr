// Research-only local CPU replay. No images/boxes/poses written to disk.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import * as coco from '@tensorflow-models/coco-ssd';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { createSharpObjectEvidence } from '../src/lib/sharp-object-evidence.ts';
import { estimateSceneMotion } from '../src/lib/scene-motion.ts';
await tf.setBackend('cpu');
const dir = new URL('../../../generated-artifacts/tracking-evaluation/coco/', import.meta.url);
const receipt = JSON.parse(readFileSync(new URL('../../../docs/tracking-model-assets.json', import.meta.url)));
const checked = name => {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Unsafe model member');
  const b = readFileSync(new URL(name, dir));
  if (createHash('sha256').update(b).digest('hex') !== receipt.files[name]) throw new Error('Changed model');
  return b;
};
const model = JSON.parse(checked('model.json'));
const bytes = Buffer.concat(model.weightsManifest.flatMap(g => g.paths.map(checked)));
const detector = await coco.load({ base: 'lite_mobilenet_v2', modelUrl: { load: async () => ({
  modelTopology: model.modelTopology, weightSpecs: model.weightsManifest.flatMap(g => g.weights),
  weightData: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
}) } });
const baseline = createRiskAssessor(), temporal = createSharpObjectEvidence();
let previous = null;
try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const m = JSON.parse(line);
    if (m.reset) {
      previous = null; baseline.reset(); temporal.reset();
      console.log(JSON.stringify({ reset: true })); continue;
    }
    const raw = new Uint8Array(Buffer.from(m.rgb, 'base64'));
    if (raw.length !== m.width * m.height * 3) throw new Error('Invalid pixels');
    const tensor = tf.tensor3d(raw, [m.height, m.width, 3], 'int32');
    let predictions;
    try { predictions = await detector.detect(tensor, 20, .2); } finally { tensor.dispose(); }
    const detections = predictions.map((p, i) => ({ id: `d${i}`, label: p.class, confidence: p.score, box: p.bbox }));
    // Person detector-only association is supported by the unchanged tracker.
    // No invented poses or posture/classifier substitutions.
    const frame = { detections, landmarks: [], latency: 0, frameTimeMs: m.timeMs };
    const assessment = baseline.assess(frame, m.width, m.height, m.timeMs);
    const current = { gray: new Uint8Array(Buffer.from(m.gray, 'base64')),
      excluded: assessment.tracking.persons.map(p => p.box), time: m.timeMs };
    const scene = estimateSceneMotion(previous, current); previous = current;
    const evidence = temporal.update({ ...frame, sceneMotion: scene }, assessment.tracking, m.width, m.height, { source: m.source, session: 'replay-window' });
    console.log(JSON.stringify({
      detections, // ephemeral pipe only for independent localization scoring
      evidence, sceneStatus: scene.status,
      baselineProximity: assessment.evidence.some(e => /and a (knife|scissors) appear close in the image/.test(e)),
    }));
  }
} finally { detector.dispose(); }
