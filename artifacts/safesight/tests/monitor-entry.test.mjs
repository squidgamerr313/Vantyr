import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialMonitorMode } from '../src/lib/monitor-entry.ts';

test('camera-first entry stays idle until explicit user action', () => {
  for (const search of ['', '?source=live', '?source=demo', '?other=simulation', '?source=', '?source=unknown']) {
    assert.equal(initialMonitorMode(search), 'off', search);
  }
});
test('only the explicitly labeled simulation entry opts into scripted input', () => {
  assert.equal(initialMonitorMode('?source=simulation'), 'demo');
  assert.equal(initialMonitorMode('?other=1&source=simulation'), 'demo');
});
