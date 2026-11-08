// Small, disclosed synthetic-text regression set, NOT a field accuracy claim.
import { pipeline, env } from '@huggingface/transformers';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { contextualSpeechReview, CONTEXT_LABELS, SPEECH_CONTEXT_MODEL, SPEECH_CONTEXT_REVISION } from '../src/lib/speech-context.ts';
const output = new URL('../../../generated-artifacts/local-speech-context/', import.meta.url);
await mkdir(output, { recursive: true });
env.cacheDir = fileURLToPath(new URL('model-cache/', output));
const model = process.argv[2] ?? SPEECH_CONTEXT_MODEL;
const revision = process.argv[3] ?? SPEECH_CONTEXT_REVISION;
const classify = await pipeline('zero-shot-classification', model, { revision, device: 'cpu', dtype: 'q8' });
const samples = [
  ['Please help me. I need help.', 'help_request'],
  ["I'll hurt you.", 'possible_threat'],
  ['You are worthless.', 'possible_abuse'],
  ['He said "I will hurt you", so I called the police.', null],
  ['I will not hurt you.', null],
  ["I'm not going to hurt you.", null],
  ['In the movie the villain said I will kill you.', null],
  ['Could you help me with my homework?', null],
  ['I hurt my knee while running yesterday.', null],
  ['You did a great job today.', null],
];
const results = [];
for (const [text, expected] of samples) {
  const start = performance.now();
  const prediction = await classify(text, [...CONTEXT_LABELS], { hypothesis_template: 'This speech is {}.', multi_label: false });
  const review = contextualSpeechReview(text, text, ['help_request', 'possible_threat', 'possible_abuse'], prediction);
  const actual = review.cues.map(c => c.category);
  results.push({ text, expected, actual, automaticEligible: review.cues.some(c => c.automaticResponseEligible), contextStatus: review.cues.map(c => c.contextStatus), pass: expected ? actual.includes(expected) : actual.length === 0, elapsedMs: Math.round(performance.now() - start), prediction });
}
await classify.dispose();
await writeFile(new URL(`${model.replaceAll('/', '-')}-results.json`, output), JSON.stringify({ model, revision, evidence: 'Synthetic text only, CPU native runtime, no microphone/ASR/browser accuracy evidence', results }, null, 2));
for (const row of results) console.info(JSON.stringify({ text: row.text, expected: row.expected, actual: row.actual, automaticEligible: row.automaticEligible, contextStatus: row.contextStatus, pass: row.pass, elapsedMs: row.elapsedMs, top: row.prediction.labels[0], score: row.prediction.scores[0] }));
