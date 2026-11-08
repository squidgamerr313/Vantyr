import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createSpeechRouter } from '../src/routes/speech';
import { validSpeechWav, parseSpeechReview } from '../src/lib/speech-review';
import { encodeSpeechWav } from '../../safesight/src/lib/speech-session';
import { inputErrors } from '../src/middlewares/input-errors';

const audio = Buffer.from(encodeSpeechWav(new Float32Array(16000).fill(.1))).toString('base64');
const input = { audio, mimeType: 'audio/wav', consent: true, categories: ['possible_threat'] };
const review = { status: 'reviewed', transcript: 'I will hurt you.', cues: [{ category: 'possible_threat', excerpt: 'hurt you', explanation: 'Potential threat; verify context.' }], limitations: 'Uncertain transcription, missing context, chunk boundaries. Human verification required.' };
async function fixture(t: { after: (f: () => void) => void }, options: Parameters<typeof createSpeechRouter>[0] = {}) {
  const app = express(); app.use(express.json({ limit: '350kb' }));
  app.use(createSpeechRouter({ generate: async () => JSON.stringify(review), ...options })); app.use(inputErrors);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('Port');
  return (body: unknown = input, headers = {}) => fetch(`http://127.0.0.1:${addr.port}/speech/review`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
test('speech accepts only actual canonical bounded PCM WAV with explicit consent', async t => {
  let calls = 0;
  const post = await fixture(t, { generate: async () => { calls++; return JSON.stringify(review); } });
  for (const body of [{ ...input, consent: false }, { ...input, mimeType: 'audio/webm' }, { ...input, categories: [] }, { ...input, categories: ['danger'] }, { ...input, audio: Buffer.alloc(20000).toString('base64') }, { ...input, extra: 'private' }])
    assert.equal((await post(body)).status, 400);
  assert.equal(calls, 0);
  const res = await post(); assert.equal(res.status, 200); assert.deepEqual(await res.json(), review); assert.equal(res.headers.get('cache-control'), 'no-store');
  for (const length of [100, 128001]) assert.equal(validSpeechWav(Buffer.from(encodeSpeechWav(new Float32Array(length))).toString('base64')), false);
  const wrong = Buffer.from(audio, 'base64'); wrong.writeUInt32LE(48000, 24); assert.equal(validSpeechWav(wrong.toString('base64')), false);
});
test('speech schema rejects malformed or unanchored/disabled model evidence, abstentions discard words', () => {
  for (const value of ['not JSON', '{}', JSON.stringify({ ...review, status: 'danger' }), JSON.stringify({ ...review, cues: [{ ...review.cues[0], excerpt: 'invented' }] })])
    assert.throws(() => parseSpeechReview(value, input.categories));
  assert.throws(() => parseSpeechReview(JSON.stringify(review), ['help_request']));
  for (const status of ['silence', 'unintelligible', 'unsupported_language', 'uncertain']) {
    const result = parseSpeechReview(JSON.stringify({ ...review, status }), input.categories);
    assert.equal(result.transcript, ''); assert.deepEqual(result.cues, []);
  }
  assert.equal(parseSpeechReview(JSON.stringify({ ...review, cues: [...review.cues, ...review.cues] }), input.categories).cues.length, 1);
});
test('digital silence abstains without provider access or invented transcript', async t => {
  let calls = 0;
  const post = await fixture(t, { generate: async () => { calls++; return JSON.stringify(review); } });
  const response = await post({ ...input, audio: Buffer.from(encodeSpeechWav(new Float32Array(96000))).toString('base64') });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.status, 'silence'); assert.equal(result.transcript, ''); assert.deepEqual(result.cues, []); assert.equal(calls, 0);
  assert.equal(parseSpeechReview(JSON.stringify({ ...review, transcript: '', cues: [] }), input.categories).status, 'uncertain');
});
test('speech rejects cross-site, rate limits and oversized payloads', async t => {
  const post = await fixture(t);
  assert.equal((await post(input, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post()).status, 200);
  const limited = await post(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '7');
  assert.equal((await post({ ...input, audio: 'x'.repeat(360000) })).status, 413);
});
test('speech retries only transient failures once, malformed output never retries', async t => {
  let calls = 0;
  const post = await fixture(t, { backoffMs: 1, generate: async () => { if (++calls === 1) throw Object.assign(new Error('sensitive provider body'), { status: 503 }); return JSON.stringify(review); } });
  assert.equal((await post()).status, 200); assert.equal(calls, 2);
  calls = 0;
  const invalid = await fixture(t, { generate: async () => { calls++; return '{}'; } });
  assert.equal((await invalid()).status, 503); assert.equal(calls, 1);
});
test('deadline aborts provider and returns only safe failure; stalled providers retain bounded capacity', async t => {
  let aborted = false, calls = 0;
  const post = await fixture(t, { deadlineMs: 10, generate: async (_a, _c, signal) => { calls++; signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); }, now: () => calls * 10000 });
  const response = await post(); assert.equal(response.status, 503); assert.equal(aborted, true);
  assert.ok(!(await response.text()).includes('transcript'));
  assert.equal((await post()).status, 503); assert.equal((await post()).status, 429); assert.equal(calls, 2);
});
