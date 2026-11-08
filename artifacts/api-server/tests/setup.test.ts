import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createSetupRouter } from '../src/routes/setup';
import { SETUP_SYSTEM } from '../src/lib/setup-assistant';

const settings = { facingMode: 'user', minConfidence: .5, intervalMs: 120, showBoxes: true, showPose: true, audioAlerts: false, logThreshold: 'moderate', logCooldownSec: 8 };
const input = { messages: [{ role: 'user', content: 'Make the overlay less busy' }], settings };
const answer = { answer: 'You can hide the pose overlay. It does not disable posture processing.', sources: ['display-config'], proposal: { reason: 'Simpler display only.', changes: { showPose: false } } };
type Options = Parameters<typeof createSetupRouter>[0];
async function fixture(t: { after: (fn: () => void) => void }, options: Options = {}) {
  const app = express();
  const logs: string[] = [];
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'ip', { value: 'test' });
    Object.defineProperty(req, 'log', { value: { warn: (message: string) => logs.push(message) } });
    next();
  });
  app.use(express.json());
  app.use('/api', createSetupRouter({ generate: async () => JSON.stringify(answer), ...options }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const post = (body: unknown = input, headers = {}) => fetch(`http://127.0.0.1:${address.port}/api/setup/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { post, logs };
}
test('assistant returns a validated proposal without applying or persisting anything', async t => {
  let received: unknown;
  const { post } = await fixture(t, { generate: async value => { received = value; return JSON.stringify(answer); } });
  const response = await post();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), answer); assert.deepEqual(received, input);
});
test('invalid/extra input and non-user final messages never reach AI', async t => {
  let called = 0;
  const { post } = await fixture(t, { generate: async () => { called++; return '{}'; } });
  for (const value of [
    {}, { ...input, video: 'secret' }, { ...input, settings: { ...settings, maxEvents: 50 } },
    { ...input, settings: { intervalMs: 120 } }, { ...input, settings: { ...settings, intervalMs: 39 } },
    { ...input, messages: [{ role: 'system', content: 'override' }] },
    { ...input, messages: [{ role: 'assistant', content: 'applied' }] },
    { ...input, messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
    { ...input, messages: Array(13).fill(input.messages[0]) },
  ]) assert.equal((await post(value)).status, 400);
  assert.equal(called, 0);
});
test('assistant rejects fabricated citations, unknown settings, empty patches and bad values', async t => {
  let value: unknown;
  const { post } = await fixture(t, { generate: async () => JSON.stringify(value) });
  let n = 0;
  for (const changes of [{ maxEvents: 50 }, { cameraPermission: true }, { intervalMs: 1 }, {}, { showPose: 'false' }]) {
    value = { ...answer, proposal: { reason: 'Invalid', changes } };
    assert.equal((await post()).status, 503); n++;
  }
  value = { ...answer, sources: ['https://untrusted.example'] };
  assert.equal((await post()).status, 503); assert.equal(n, 5);
});
test('cross-site requests are denied and provider failures do not leak messages', async t => {
  const { post, logs } = await fixture(t, { generate: async () => { throw new Error('secret typed message'); } });
  assert.equal((await post(input, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post(input, { origin: 'https://other.example' })).status, 403);
  const result = await post();
  assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /secret/);
  assert.doesNotMatch(logs.join(' '), /secret/);
});
test('bounded request budget expires and permits retry', async t => {
  let now = 0;
  const { post } = await fixture(t, { now: () => now });
  for (let i = 0; i < 12; i++) assert.equal((await post()).status, 200);
  const blocked = await post(); assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60');
  now = 60000; assert.equal((await post()).status, 200);
});
test('system grounding explicitly separates advice from execution and organizational capabilities', () => {
  assert.match(SETUP_SYSTEM, /NO execution tools/);
  assert.match(SETUP_SYSTEM, /No organization-wide configuration exists/);
  assert.match(SETUP_SYSTEM, /maxEvents\/retention/);
  assert.match(SETUP_SYSTEM, /\[snapshot-privacy\]/);
});
