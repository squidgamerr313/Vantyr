import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { armAudio, playAlert } from '../src/lib/audio.ts';
const contexts = [];
let blocked = false, fail = false;
class Audio {
  state = 'suspended'; currentTime = 0; destination = {}; oscillators = [];
  constructor() { contexts.push(this); }
  async resume() { if (fail) throw new Error('blocked'); if (!blocked) this.state = 'running'; }
  createOscillator() {
    const oscillator = { frequency: { value: 0 }, connect: () => ({ connect() {} }), disconnect() {}, start() {}, stop() {}, onended: null };
    this.oscillators.push(oscillator); return oscillator;
  }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, disconnect() {} }; }
}
globalThis.window = { AudioContext: Audio };
beforeEach(() => {
  if (contexts.length) {
    contexts.at(-1).oscillators.forEach((o) => o.onended?.());
    contexts.at(-1).state = 'closed';
  }
  window.AudioContext = Audio; blocked = false; fail = false;
});
test('audio is resumed explicitly and a single reusable context prevents overlapping cues', async () => {
  assert.equal(await armAudio(), null);
  const context = contexts.at(-1);
  await Promise.all([playAlert(), playAlert()]);
  assert.equal(context.oscillators.length, 1);
  context.oscillators[0].onended();
  await playAlert(); assert.equal(context.oscillators.length, 2);
});
test('suspended/blocked audio is reported without pretending playback succeeded', async () => {
  blocked = true;
  assert.match(await playAlert(), /blocked/);
  assert.equal(contexts.at(-1).oscillators.length, 0);
  fail = true; assert.match(await armAudio(), /could not be enabled/);
});
test('unsupported browser audio has an actionable visual-only outcome', async () => {
  window.AudioContext = undefined;
  assert.match(await armAudio(), /unavailable.*Visual alerts remain active/);
});
