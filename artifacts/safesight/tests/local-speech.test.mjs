import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasAudibleSignal, reviewLocalTranscript, decodeLocalWav } from '../src/lib/local-speech-rules.ts';
import { createLocalSpeechClient } from '../src/lib/local-speech-client.ts';
import { createSpeechSession, encodeSpeechWav } from '../src/lib/speech-session.ts';

test('literal local rules respect selected categories and never invent semantic coverage', () => {
  const selected = ['help_request', 'possible_threat', 'possible_abuse'];
  for (const [text, category] of [['Please help me!', 'help_request'], ["I'll hurt you", 'possible_threat'], ['You are worthless', 'possible_abuse']]) {
    const result = reviewLocalTranscript(text, selected);
    assert.equal(result.cues[0].category, category);
    assert.ok(text.includes(result.cues[0].excerpt));
    assert.match(result.limitations, /not abuse or intent recognition/);
  }
  assert.deepEqual(reviewLocalTranscript('This is fucking difficult.', selected).cues, []);
  assert.equal(reviewLocalTranscript('This is fucking difficult.', ['profanity']).cues.length, 1);
  assert.deepEqual(reviewLocalTranscript('A normal conversation about lunch.', selected).cues, []);
  assert.equal(reviewLocalTranscript('', selected).status, 'unintelligible');
});

test('energy gate skips silence and very short clicks but does not claim to identify speech', () => {
  assert.equal(hasAudibleSignal(new Float32Array(48000)), false);
  const click = new Float32Array(48000); click[500] = 1;
  assert.equal(hasAudibleSignal(click), false);
  assert.equal(hasAudibleSignal(new Float32Array(48000).fill(.02)), true);
});

test('local PCM is copied synchronously before WAV buffer is cleared', () => {
  const bytes = encodeSpeechWav(new Float32Array(48000).fill(.25));
  const pcm = decodeLocalWav(bytes); bytes.fill(0);
  assert.equal(pcm.length, 48000);
  assert.ok(Math.abs(pcm[0] - .25) < .001);
  assert.throws(() => decodeLocalWav(new Uint8Array(30)));
});

function clientFixture() {
  const workers = [];
  const local = createLocalSpeechClient(() => {
    const worker = { onmessage: null, onerror: null, messages: [], terminated: false,
      postMessage(message) { this.messages.push(message); },
      terminate() { this.terminated = true; },
      emit(data) { this.onmessage?.({ data }); },
    };
    workers.push(worker); return worker;
  });
  return { local, workers };
}
test('worker is lazy, preparation never captures audio, and stop rejects pending work', async () => {
  const { local, workers } = clientFixture();
  assert.equal(workers.length, 0);
  const abort = new AbortController();
  const prepare = local.prepare(abort.signal, () => {});
  const worker = workers[0];
  assert.deepEqual(worker.messages, [{ type: 'load' }]);
  worker.emit({ type: 'ready' }); await prepare;
  const bytes = encodeSpeechWav(new Float32Array(48000).fill(.2));
  const pending = local.review(bytes, ['help_request'], abort.signal);
  bytes.fill(0);
  assert.ok(worker.messages[1].samples[0] > .19);
  const rejection = assert.rejects(pending, /stopped/);
  abort.abort(); await rejection;
  assert.equal(worker.terminated, true);
});
test('worker failure fails closed instead of trying an upload', async () => {
  const { local, workers } = clientFixture();
  const pending = local.prepare(new AbortController().signal, () => {});
  const rejection = assert.rejects(pending, /unavailable/);
  workers[0].emit({ type: 'error' }); await rejection;
  assert.equal(workers[0].terminated, true);
});
test('late events from a terminated worker cannot settle its replacement session', async () => {
  const { local, workers } = clientFixture();
  const first = local.prepare(new AbortController().signal, () => {});
  const rejection = assert.rejects(first);
  local.close(); await rejection;
  let finished = false;
  const second = local.prepare(new AbortController().signal, () => {}).then(() => { finished = true; });
  workers[0].emit({ type: 'ready' }); await Promise.resolve();
  assert.equal(finished, false);
  workers[1].emit({ type: 'ready' }); await second; local.close();
});
test('model preparation precedes microphone request and cancelled preparation never opens it', async () => {
  let acquired = 0, finish;
  const states = [];
  const session = createSpeechSession({
    prepare: () => new Promise(resolve => { finish = resolve; }),
    acquire: async () => { acquired++; throw new Error('Not expected'); },
    capture: async () => { throw new Error('Not expected'); },
    review: async () => { throw new Error('Not expected'); },
    publish: s => states.push(s), visible: () => true,
  });
  const start = session.start(['help_request']);
  assert.equal(states.at(-1).phase, 'loading'); assert.equal(acquired, 0);
  session.stop(); finish(); await start;
  assert.equal(acquired, 0); assert.equal(states.at(-1).phase, 'stopped');
});
test('live hook has no cloud speech client and worker only accepts public asset GETs', () => {
  const hook = readFileSync(new URL('../src/hooks/use-speech-review.ts', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../src/lib/local-speech.worker.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(hook, /reviewSpeech|fetch\(|btoa|SpeechRecognition/);
  assert.match(hook, /prepare: local.prepare, release: local.close, review: local.review/);
  assert.match(worker, /method.toUpperCase\(\) !== 'GET'/);
  assert.match(worker, /credentials: 'omit'/);
  assert.match(worker, /samples\?\.fill\(0\)/);
  assert.match(worker, /numThreads = 1/);
  const routes = readFileSync(new URL('../../api-server/src/routes/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(routes, /import speechRouter|use\(speechRouter\)/);
  assert.match(routes, /status\(410\)/);
});
