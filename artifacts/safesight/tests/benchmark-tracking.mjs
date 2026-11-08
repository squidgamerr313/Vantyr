import { createLegacyRiskAssessor } from './fixtures/legacy-risk.mjs';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { peopleFrame, person } from './fixtures/people.mjs';
const frame = peopleFrame([person(.2), person(.5), person(.8)]);
const iterations = 20000;
function measure(factory) {
  const samples = [];
  for (let batch = 0; batch < 5; batch++) {
    const assess = factory();
    for (let i = 0; i < 2000; i++) assess(frame, 1000, 600, i * 120);
    const start = performance.now();
    for (let i = 2000; i < iterations + 2000; i++) assess(frame, 1000, 600, i * 120);
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a, b) => a - b);
  return { medianMsPerFrame: samples[2], syntheticAssessmentFramesPerSecond: 1000 / samples[2], samplesMs: samples };
}
console.log(JSON.stringify({
  warning: 'Risk/tracking CPU stage only. Excludes models, video decoding, canvas, React and storage. NOT camera/inference FPS or detection accuracy.',
  node: process.version, fixture: 'three separated people and three visible stationary poses; 1000x600; 120ms timestamps',
  iterationsPerBatch: iterations,
  legacy: measure(createLegacyRiskAssessor),
  tracked: measure(() => createRiskAssessor().assess),
}, null, 2));
