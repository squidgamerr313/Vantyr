import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/?>/)?.[1];
const expected = "connect-src 'self' https://storage.googleapis.com https://cdn.jsdelivr.net";

test('monitoring limits connections before any app script or external resource loads', () => {
  assert.equal(policy, expected);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<link'));
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
  assert.equal(html.match(/http-equiv="Content-Security-Policy"/g)?.length, 1);
});

test('model downloads and consented same-origin APIs are allowed, vendor logging is not', () => {
  const sources = policy.split(/\s+/).slice(1);
  const appOrigin = 'https://app.example';
  const permitted = url => sources.includes(new URL(url).origin) ||
    (sources.includes("'self'") && new URL(url).origin === appOrigin);
  for (const url of [
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    'https://storage.googleapis.com/tfjs-models/savedmodel/ssd_mobilenet_v2/model.json',
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm/vision_wasm_internal.wasm',
    'https://app.example/api/safety/analyze',
    'https://app.example/api/healthz',
  ]) assert.ok(permitted(url), url);
  for (const url of ['https://odml.pa.googleapis.com/v1/log', 'https://unapproved.example/upload'])
    assert.equal(permitted(url), false);
  assert.ok(!policy.includes('*') && !policy.includes('http:'));
});
