import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, EventReview;
before(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  server = await createServer({
    root, configFile: false, logLevel: 'silent',
    resolve: { alias: { '@': `${root}src` } }, esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  ({ EventReview } = await server.ssrLoadModule('/src/components/zone-review.tsx'));
});
after(async () => { await server?.close(); });
const risk = { id: 'r', ts: 500, source: 'live', kind: 'risk', level: 'moderate', score: 52, evidence: ['Old text'], detections: 1 };
const render = (event) => renderToStaticMarkup(createElement(EventReview, { event }));
test('saved risk has event-aware human check controls without implying a physical visit or confirmed fall', () => {
  const html = render(risk);
  assert.match(html, /Saved camera observation/);
  assert.match(html, /On-device rule observation/);
  assert.match(html, /Human check not recorded/);
  assert.match(html, /Human outcome: <strong>Not recorded/);
  for (const text of ['Assistance needed', 'No assistance needed', 'Unable to verify', 'separate from workflow status', 'not a confirmed fall or injury', 'not machine-verified harm or model-training labels']) assert.ok(html.includes(text), text);
  assert.match(html, /data-testid="review-note-r"/);
  assert.doesNotMatch(html, /button-resolve-r/); // No skipped review.
});
test('unable-to-verify reviewed record has disabled resolve and a repeat-check action', () => {
  const html = render({ ...risk, review: { status: 'reviewed', actions: [{ status: 'reviewed', at: 600, note: '<draft>', outcome: 'unable-to-verify' }] } });
  assert.match(html, /Save follow-up check/);
  assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="button-resolve-r"/);
  assert.match(html, /data-testid="confirm-resolve-r"/);
  assert.match(html, /does not assert a physical person-check/);
  assert.match(html, /&lt;draft&gt;/);
  assert.match(html, /cannot resolve the record/);
});
test('terminal legacy review renders no writable controls or invented assistance outcome', () => {
  const html = render({ ...risk, review: { status: 'resolved', actions: [{ status: 'reviewed', at: 600, note: 'Old check' }, { status: 'resolved', at: 700, note: '' }] } });
  assert.match(html, /Human outcome: <strong>Not recorded/);
  assert.match(html, /can no longer be changed/);
  assert.doesNotMatch(html, /review-note-r|review-outcome-r|button-review-r|button-dismiss-r/);
});
test('AI snapshot history is not repurposed; zone form retains temporary person and source context', () => {
  assert.equal(render({ ...risk, kind: 'analysis' }), '');
  const html = render({ ...risk, kind: 'zone', source: 'demo', zone: { personLabel: 'Person 1', dwellMs: 4000, timestampBasis: 'simulation', zone: { name: 'Bench <A>', dwellSec: 4 } }, review: { status: 'open', actions: [] } });
  assert.match(html, /Saved simulation/);
  assert.match(html, /Zone flag/);
  assert.match(html, /Person 1/);
  assert.match(html, /Bench &lt;A&gt;/);
  assert.match(html, /4\.0 s/);
  assert.doesNotMatch(html, /I confirm a person checked the area/);
});
