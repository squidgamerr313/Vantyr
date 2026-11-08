import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const dir = resolve('generated-artifacts/hero-engine-recording');
const file = name => resolve(dir, name);
const report = JSON.parse(await readFile(file('provenance.json'), 'utf8'));
const first = report.analyses.find(s => s.accepted &&
  s.result.detections.some(d => d.label === 'person') && s.result.landmarks.length);
if (!first) throw Error('No actual person/pose output to demonstrate');
// Select the beginning of the demonstration after initial waiting. Do not
// speed up time, interpolate outputs or remove any subsequent misses.
const startSeconds = (first.completedMs + 250) / 1000;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(startSeconds),
  '-i', file('capture.webm'), '-vf', 'fps=24', '-an', '-c:v', 'libx264',
  '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', file('engine.mp4')]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1',
  '-i', file('engine.mp4'), '-frames:v', '1', file('poster.jpg')]);
report.presentation = {
  startMs: first.completedMs + 250,
  selection: 'Initial wait omitted; subsequent sequence unchanged, including misses',
  speed: 1, framesPerSecond: 24,
  mp4Sha256: createHash('sha256').update(await readFile(file('engine.mp4'))).digest('hex'),
};
await writeFile(file('provenance.json'), JSON.stringify(report, null, 2));
console.log('Prepared real-time demonstration segment');
