import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindSpeechLifecycle, createSpeechSession, DEFAULT_SPEECH_CATEGORIES, encodeSpeechWav } from '../src/lib/speech-session.ts';
const turn = () => new Promise(r => setTimeout(r, 0));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const review = { status: 'reviewed', transcript: 'Help me.', cues: [{ category: 'help_request', excerpt: 'Help me', explanation: 'Possible call for help, verify.' }], limitations: 'Uncertain transcription and missing context; human verification.' };
function fixture(overrides = {}) {
  const track = new EventTarget(); Object.assign(track, { enabled: true, readyState: 'live', muted: false, stops: 0, stop() { this.stops++; } });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let chunk, fail, closes = 0, calls = 0; const states = [];
  const session = createSpeechSession({ acquire: async () => stream, capture: async (_s, c, f) => { chunk = c; fail = f; return { close() { closes++; } }; },
    review: async () => { calls++; return review; }, publish: s => states.push(s), visible: () => true, ...overrides });
  return { session, track, stream, states, deliver: () => chunk(new Float32Array(96000)), fail: () => fail(), closes: () => closes, calls: () => calls };
}
test('default is off and profanity independently disabled; WAV bytes carry exact duration', () => {
  const f = fixture(); assert.equal(f.states.length, 0); assert.equal(f.calls(), 0); assert.equal(f.track.stops, 0);
  assert.ok(!DEFAULT_SPEECH_CATEGORIES.includes('profanity'));
  const bytes = encodeSpeechWav(new Float32Array(96000)); const view = new DataView(bytes.buffer);
  assert.equal(bytes.length, 192044); assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint32(40, true) / 32000, 6);
});
test('explicit start listens, backpressure pauses track, no queue or uploads after stop', async () => {
  const pending = defer(); let calls = 0;
  const f = fixture({ review: async () => { calls++; return pending.promise; } });
  await f.session.start(DEFAULT_SPEECH_CATEGORIES); assert.equal(f.states.at(-1).phase, 'listening');
  f.deliver(); await turn(); assert.equal(f.states.at(-1).phase, 'processing'); assert.equal(f.track.enabled, false); assert.equal(f.closes(), 1);
  f.deliver(); await turn(); assert.equal(calls, 1);
  f.session.stop(); pending.resolve(review); await turn();
  assert.equal(f.states.at(-1).phase, 'stopped'); assert.deepEqual(f.states.at(-1).cues, []); assert.equal(f.track.stops, 1);
});
test('late permission, session replacement, denial, unavailable capture and timeouts fail closed', async () => {
  const pending = defer(), f = fixture({ acquire: () => pending.promise });
  const start = f.session.start(DEFAULT_SPEECH_CATEGORIES); f.session.stop(); pending.resolve(f.stream); await start; await turn(); assert.equal(f.track.stops, 1);
  for (const overrides of [
    { acquire: async () => { throw new DOMException('Denied', 'NotAllowedError'); } },
    { capture: async () => { throw new Error('Unsupported'); } },
    { acquire: () => new Promise(() => {}), permissionMs: 5 },
  ]) { const g = fixture(overrides); await g.session.start(DEFAULT_SPEECH_CATEGORIES); assert.equal(g.states.at(-1).phase, 'unavailable'); }
  const g = fixture({ review: () => new Promise(() => {}), reviewMs: 5 });
  await g.session.start(DEFAULT_SPEECH_CATEGORIES); g.deliver(); await new Promise(r => setTimeout(r, 15));
  assert.equal(g.states.at(-1).phase, 'unavailable'); assert.equal(g.track.stops, 1);
});
test('mute, revoked/ended track, capture interruption clear evidence and never auto resume', async () => {
  for (const action of ['mute', 'ended', 'capture']) {
    const f = fixture(); await f.session.start(DEFAULT_SPEECH_CATEGORIES);
    if (action === 'capture') f.fail(); else f.track.dispatchEvent(new Event(action));
    assert.equal(f.states.at(-1).phase, 'unavailable'); assert.equal(f.track.stops, 1);
    assert.deepEqual(f.states.at(-1).cues, []);
  }
});
test('cues remain memory-only and dismissible, abstentions and disabled categories create no flags', async () => {
  const f = fixture(); await f.session.start(DEFAULT_SPEECH_CATEGORIES); f.deliver(); await turn();
  assert.equal(f.states.at(-1).cues.length, 1); f.session.dismiss(f.states.at(-1).cues[0].id); assert.deepEqual(f.states.at(-1).cues, []); f.session.stop();
  for (const value of [{ ...review, status: 'unintelligible' }, { ...review, cues: [{ ...review.cues[0], category: 'profanity' }] }]) {
    const g = fixture({ review: async () => value }); await g.session.start(DEFAULT_SPEECH_CATEGORIES); g.deliver(); await turn();
    assert.deepEqual(g.states.at(-1).cues, []); g.session.stop();
  }
  for (const path of ['../src/lib/speech-session.ts', '../src/lib/speech-capture.ts', '../src/hooks/use-speech-review.ts']) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /localStorage|sessionStorage|addEvent\(|saveCheck\(|console\.|indexedDB|sendBeacon|useReviewSpeech\(/);
  }
});
test('replacement invalidates pending review and background consent never starts capture', async () => {
  const pending = defer(); const f = fixture({ review: () => pending.promise });
  await f.session.start(DEFAULT_SPEECH_CATEGORIES); f.deliver(); await turn();
  await f.session.start(DEFAULT_SPEECH_CATEGORIES); pending.resolve(review); await turn();
  assert.equal(f.states.at(-1).phase, 'listening'); assert.deepEqual(f.states.at(-1).cues, []); f.session.stop();
  const hidden = fixture({ visible: () => false }); await hidden.session.start(DEFAULT_SPEECH_CATEGORIES);
  assert.equal(hidden.states.at(-1).phase, 'stopped');
});
test('duplicates stay dismissed across chunks, review list stays bounded, new session clears deduplication', async () => {
  const nextChunk = async (f) => {
    f.deliver();
    // Poll the actual state instead of racing fixed sleeps under parallel tests.
    await turn();
    for (let n = 0; f.states.at(-1).phase !== 'listening' && n < 200; n++) await new Promise(r => setTimeout(r, 2));
    assert.equal(f.states.at(-1).phase, 'listening');
  };
  let count = 0;
  const f = fixture({ gapMs: 1, now: () => 1000 + count, review: async () => {
    count++;
    return count < 3 ? review : { ...review, cues: [{ ...review.cues[0], excerpt: `Phrase ${count}` }] };
  } });
  await f.session.start(DEFAULT_SPEECH_CATEGORIES);
  await nextChunk(f);
  const id = f.states.at(-1).cues[0].id; f.session.dismiss(id);
  await nextChunk(f);
  assert.deepEqual(f.states.at(-1).cues, []);
  for (let i = 0; i < 15; i++) await nextChunk(f);
  assert.equal(f.states.at(-1).cues.length, 12);
  f.session.stop(); assert.deepEqual(f.states.at(-1).cues, []);
  count = 0; await f.session.start(DEFAULT_SPEECH_CATEGORIES); await nextChunk(f);
  assert.equal(f.states.at(-1).cues.length, 1); f.session.stop();
});
test('background, foreground, pagehide and unmount revoke ownership without resuming or late publications', async () => {
  const page = new EventTarget(), navigation = new EventTarget(); page.visibilityState = 'visible';
  const pending = defer(), f = fixture({ review: () => pending.promise });
  const cleanup = bindSpeechLifecycle(page, navigation, f.session.stop);
  await f.session.start(DEFAULT_SPEECH_CATEGORIES); f.deliver(); await turn();
  page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.states.at(-1).phase, 'unavailable'); assert.equal(f.track.stops, 1);
  const count = f.states.length;
  page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
  pending.resolve(review); await turn();
  assert.equal(f.states.length, count); assert.deepEqual(f.states.at(-1).cues, []);
  await f.session.start(DEFAULT_SPEECH_CATEGORIES); navigation.dispatchEvent(new Event('pagehide'));
  assert.equal(f.states.at(-1).phase, 'stopped');
  await f.session.start(DEFAULT_SPEECH_CATEGORIES); cleanup();
  const end = f.states.length; page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'));
  navigation.dispatchEvent(new Event('pagehide')); await turn();
  assert.equal(f.states.length, end);
});
