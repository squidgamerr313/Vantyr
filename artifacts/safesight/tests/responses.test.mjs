import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameraResponseReadiness, createResponseGate, DEFAULT_RESPONSES, responsePayload, sendResponseWebhook, validateWebhook } from '../src/lib/responses.ts';
import { CONTEXT_LABELS, contextualSpeechReview, createSpeechContext } from '../src/lib/speech-context.ts';
const config = { ...DEFAULT_RESPONSES, tone: true };
const cue = (id, at, source = 'live', kind = 'camera-posture') => ({ id, at, source, kind });

test('responses are off until explicitly armed; stale, old, future and simulation cues are excluded', () => {
  const gate = createResponseGate();
  assert.equal(gate.admit(cue('a', 1000), config, 1000), false);
  gate.arm(1000);
  for (const event of [cue('old', 999), cue('stale', 1001), cue('future', 40000), cue('demo', 30000, 'demo')]) {
    assert.equal(gate.admit(event, config, 30000), false);
  }
  assert.equal(gate.admit(cue('fresh', 30000), config, 30001), true);
  gate.disarm(); assert.equal(gate.admit(cue('after-stop', 30002), config, 30002), false);
});
test('one automatic batch per minute, deduplication across cooldowns, no retry queue', () => {
  const gate = createResponseGate(); gate.arm(1000);
  assert.equal(gate.admit(cue('first', 1001), config, 1001), true);
  assert.equal(gate.admit(cue('second', 59000), config, 59000), false);
  // The suppressed cue is consumed, never replayed when cooldown expires.
  assert.equal(gate.admit(cue('second', 59000), config, 61002), false);
  assert.equal(gate.admit(cue('third', 62000), config, 62000), true);
  assert.equal(gate.admit(cue('third', 122001), config, 122001), false);
});
test('disabled cue kinds are not admitted; manual tests remain labelled tests', () => {
  const gate = createResponseGate(); gate.arm(100);
  assert.equal(gate.admit(cue('voice', 101, 'live', 'voice-help'), { ...config, kinds: ['camera-posture'] }, 101), false);
  assert.equal(gate.admit(cue('test', 102, 'test'), config, 102), false);
  assert.equal(gate.admit(cue('test', 102, 'test'), config, 102, true), true);
});
test('webhooks reject credential URLs, local hosts, IP literals, HTTP, fragments and unusual ports', () => {
  for (const url of ['http://example.org/', 'https://user:pass@example.org/', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://service.local/', 'https://example.org:8443/', 'https://example.org/#secret', 'https://2130706433/']) assert.ok(validateWebhook(url), url);
  assert.equal(validateWebhook('https://hooks.example.org/endpoint?key=operator-owned'), null);
});
test('only minimal metadata can cross the webhook boundary; one JSON POST, no credentials or redirects', async () => {
  const event = { ...cue('public-id', 1000), transcript: 'private', audio: 'private', personName: 'private', score: 99, zone: 'private' };
  assert.deepEqual(Object.keys(responsePayload(event)).sort(), ['version', 'eventId', 'eventType', 'capturedAt', 'source', 'humanReviewRequired'].sort());
  let calls = 0;
  await sendResponseWebhook(event, 'https://hooks.example.org/', new AbortController().signal, async (url, input) => {
    calls++;
    assert.equal(input.credentials, 'omit'); assert.equal(input.redirect, 'error'); assert.equal(input.mode, 'cors');
    assert.equal(input.method, 'POST'); assert.equal(input.referrerPolicy, 'no-referrer');
    assert.ok(!input.body.includes('private'));
    return { ok: true };
  });
  assert.equal(calls, 1);
  await assert.rejects(sendResponseWebhook(event, 'https://hooks.example.org/', new AbortController().signal, async () => { calls++; throw new Error('CORS'); }));
  assert.equal(calls, 2); // exactly one additional attempt, never retried
});

const prediction = (top, score = .9) => {
  const labels = [top, ...CONTEXT_LABELS.filter(label => label !== top)];
  return { labels, scores: [score, ...labels.slice(1).map(() => (1 - score) / 4)] };
};
test('context-supported current phrase may be eligible; uncertain match stays human-review-only', () => {
  const supported = contextualSpeechReview('Please help me.', 'Please help me.', ['help_request'], prediction(CONTEXT_LABELS[1]));
  assert.equal(supported.cues[0].automaticResponseEligible, true);
  const uncertain = contextualSpeechReview("I'll hurt you.", "I'll hurt you.", ['possible_threat'], prediction(CONTEXT_LABELS[2], .48));
  assert.equal(uncertain.cues[0].contextStatus, 'uncertain');
  assert.equal(uncertain.cues[0].automaticResponseEligible, false);
  assert.match(uncertain.cues[0].explanation, /cannot automatically/);
});
test('quotes, negation and routine task help are conservative suppressions, not intent predictions', () => {
  for (const text of ['He said "I will hurt you".', 'I will not hurt you.', "I'm not going to hurt you.", 'In the movie I said I will kill you.', 'Could you help me with my homework?']) {
    assert.deepEqual(contextualSpeechReview(text, text, ['help_request', 'possible_threat'], prediction(CONTEXT_LABELS[0])).cues, [], text);
  }
});
test('context alone cannot repeat a cue, invalid model output cannot qualify automation, profanity never qualifies', () => {
  assert.deepEqual(contextualSpeechReview('Lunch is ready.', 'Please help me. Lunch is ready.', ['help_request'], prediction(CONTEXT_LABELS[1])).cues, []);
  const invalid = contextualSpeechReview('Please help me.', 'Please help me.', ['help_request'], { labels: [], scores: [] });
  assert.equal(invalid.cues[0].automaticResponseEligible, false);
  const profanity = contextualSpeechReview('This is fucking hard.', 'This is fucking hard.', ['profanity'], prediction(CONTEXT_LABELS[0]));
  assert.equal(profanity.cues[0].automaticResponseEligible, false);
});
test('context is bounded and expires across pauses and clock reversals', () => {
  const context = createSpeechContext();
  context.add('one', 100); context.add('two', 200); context.add('three', 300);
  assert.equal(context.add('four', 400), 'two three four');
  assert.equal(context.add('new session', 20000), 'new session');
  assert.equal(context.add('clock reset', 1), 'clock reset');
  context.clear(); assert.equal(context.add('fresh', 2), 'fresh');
});
test('webhook delivery is isolated without widening the camera telemetry network policy', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /connect-src 'self' https:\/\/storage.googleapis.com https:\/\/cdn.jsdelivr.net"/);
  const worker = readFileSync(new URL('../src/lib/response-webhook.worker.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /@huggingface|@mediapipe|@tensorflow|audio:/);
  assert.match(worker, /if \(used\) return/);
  const client = readFileSync(new URL('../src/lib/response-webhook-client.ts', import.meta.url), 'utf8');
  assert.match(client, /worker.terminate\(\)/);
  assert.match(client, /removeEventListener\('abort'/);
});
test('manual test admission cannot arm, disarm or reset the independent live cooldown', () => {
  const live = createResponseGate();
  const manual = () => createResponseGate().admit(cue('manual', 2000, 'test'), config, 2000, true);
  assert.equal(manual(), true);
  assert.equal(live.admit(cue('not-enabled', 2001), config, 2001), false);
  live.arm(3000);
  assert.equal(live.admit(cue('first-live', 3001), config, 3001), true);
  assert.equal(manual(), true);
  assert.equal(live.admit(cue('cooldown', 4000), config, 4000), false);
  assert.equal(live.admit(cue('next-live', 64000), config, 64000), true);
  const hook = readFileSync(new URL('../src/hooks/use-responses.ts', import.meta.url), 'utf8');
  const testAction = hook.slice(hook.indexOf('test: async () =>'));
  assert.doesNotMatch(testAction, /setArmed|gate\.current\.(?:arm|disarm)|current\.current\.armed\s*=/);
  assert.match(hook, /test \? createResponseGate\(\) : gate.current/);
});
test('camera readiness distinguishes fresh tool labels from stale, stopped and simulated evidence', () => {
  const actual = cameraResponseReadiness('live', true, ['person', 'scissors'], false);
  assert.match(actual.tools, /scissors: label detected/);
  assert.match(actual.tools, /knife: not labelled/);
  assert.doesNotMatch(actual.input, /stabbing|attack detected|safe/);
  assert.match(cameraResponseReadiness('live', false, ['scissors'], true).tools, /withheld/);
  assert.match(cameraResponseReadiness('off', false, ['scissors'], false).input, /stopped/);
  assert.match(cameraResponseReadiness('demo', true, ['scissors'], true).input, /simulation/);
  assert.match(cameraResponseReadiness('live', true, [], true).input, /once per new episode/);
});
