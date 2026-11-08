import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createSafetyRouter } from '../src/routes/safety';
import { inputErrors } from '../src/middlewares/input-errors';

const bytes = Buffer.alloc(120, 0);
bytes.set([0xff, 0xd8, 0xff]); bytes.set([0xff, 0xd9], 118);
const image = `data:image/jpeg;base64,${bytes.toString('base64')}`;
const assessment = { summary: 'Synthetic fixture', risk: 'uncertain', evidence: ['Fixture only'], recommendations: ['Verify manually'], limitations: 'Single frame. Human verification required.' };
type Options = Parameters<typeof createSafetyRouter>[0];
async function fixture(t: { after: (fn: () => void) => void }, options: Options = {}) {
  const app = express();
  const logs: string[] = [];
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'ip', { value: req.get('x-test-ip') ?? 'fixture' });
    Object.defineProperty(req, 'log', { value: { warn: (message: string) => logs.push(message) } });
    next();
  });
  app.use(express.json({ limit: '6mb' }));
  app.use('/api', createSafetyRouter({ generate: async () => JSON.stringify(assessment), ...options }));
  app.use(inputErrors);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const url = `http://127.0.0.1:${address.port}/api/safety/analyze`;
  const post = (body: unknown = { image }, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { post, url, logs };
}
test('valid consented input reaches the provider exactly, returning validated uncached JSON', async (t) => {
  let received: unknown;
  const { post } = await fixture(t, { generate: async (...args) => { received = args; return JSON.stringify(assessment); } });
  const res = await post({ image, context: 'Synthetic lab context' });
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), assessment);
  assert.deepEqual(received, [bytes.toString('base64'), 'Synthetic lab context']);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
test('wrong types, context limits, formats, incomplete JPEGs and oversized images never call the provider', async (t) => {
  let calls = 0;
  const { post } = await fixture(t, { generate: async () => { calls++; return '{}'; } });
  const oversized = Buffer.alloc(4 * 1024 * 1024 + 1, 0xff);
  for (const body of [
    {}, { image: 4 }, { image, context: 4 }, { image, context: 'x'.repeat(1001) },
    { image: image.replace('jpeg', 'png') }, { image: 'data:image/jpeg;base64,!bad' },
    { image: `data:image/jpeg;base64,${Buffer.alloc(120).toString('base64')}` },
    { image: `data:image/jpeg;base64,${bytes.subarray(0, -2).toString('base64')}` },
    { image: `data:image/jpeg;base64,${oversized.toString('base64')}` },
  ]) assert.equal((await post(body)).status, 400);
  assert.equal(calls, 0);
});
test('cross-site requests are rejected before provider access', async (t) => {
  const { post } = await fixture(t);
  assert.equal((await post({ image }, { 'sec-fetch-site': 'cross-site' })).status, 403);
});
test('per-client cooldown returns 429 with Retry-After and permits retry at ten seconds', async (t) => {
  let now = 0;
  const { post } = await fixture(t, { now: () => now });
  assert.equal((await post()).status, 200);
  const blocked = await post(); assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '10');
  now = 10000; assert.equal((await post()).status, 200);
});
test('provider errors and malformed responses return safe 503s, without logging input', async (t) => {
  const responses = [() => { throw new Error('private-context-image'); }, () => 'not JSON', () => '{"risk":"high"}', () => JSON.stringify({ ...assessment, risk: 'safe' })];
  for (const response of responses) {
    const { post, logs } = await fixture(t, { generate: async () => response() });
    const res = await post({ image, context: 'private-context-image' });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /temporarily unavailable/);
    assert.equal(logs.length, 1); assert.ok(!logs[0]!.includes('private-context-image'));
  }
});
test('global concurrency is capped at two and released after success or failure', async (t) => {
  const pending: { resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
  const { post } = await fixture(t, { generate: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  const first = post({ image }, { 'x-test-ip': 'a' });
  while (pending.length < 1) await new Promise((r) => setTimeout(r, 2));
  const second = post({ image }, { 'x-test-ip': 'b' });
  while (pending.length < 2) await new Promise((r) => setTimeout(r, 2));
  assert.equal((await post({ image }, { 'x-test-ip': 'c' })).status, 429);
  pending[0]!.resolve(JSON.stringify(assessment)); assert.equal((await first).status, 200);
  pending[1]!.reject(new Error('fixture outage')); assert.equal((await second).status, 503);
  const third = post({ image }, { 'x-test-ip': 'd' });
  while (pending.length < 3) await new Promise((r) => setTimeout(r, 2));
  pending[2]!.resolve(JSON.stringify(assessment)); assert.equal((await third).status, 200);
});
test('malformed and oversized JSON use actionable JSON responses, not HTML stack traces', async (t) => {
  const { url } = await fixture(t);
  for (const [body, status] of [['{"image":', 400], [JSON.stringify({ image: 'x'.repeat(6 * 1024 * 1024) }), 413]] as const) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(res.status, status); assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(typeof (await res.json()).error, 'string');
  }
});
