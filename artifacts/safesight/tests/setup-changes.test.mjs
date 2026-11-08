import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE, SETUP_KEYS, validSetupPatch, pickSetupSettings } from '@workspace/safesight-guide';
import { proposalConflicts, changedValues, previousValues } from '../src/lib/setup-changes.ts';

const settings = { facingMode: 'user', minConfidence: .5, intervalMs: 120, showBoxes: true, showPose: true, audioAlerts: false, logThreshold: 'moderate', logCooldownSec: 8 };
test('all preference keys and all documented workflows have shared reference content', () => {
  assert.equal(new Set(GUIDE.map(a => a.id)).size, GUIDE.length);
  for (const id of ['getting-started', 'observations', 'simulation', 'zones', 'review-events', 'snapshot-privacy', 'camera-config', 'display-config', 'logging-config', 'organization', 'troubleshooting']) {
    assert.ok(GUIDE.some(a => a.id === id && a.paragraphs.length));
  }
  assert.equal(SETUP_KEYS.length, 8);
  assert.deepEqual(pickSetupSettings({ ...settings, maxEvents: 300, events: ['private'] }), settings);
});
test('assistant proposal validation forbids destructive and unsupported actions', () => {
  for (const p of [{}, { maxEvents: 50 }, { reset: true }, { zone: {} }, { audioAlerts: 'true' }, { intervalMs: 39 }, { logCooldownSec: 1.5 }, { minConfidence: NaN }]) assert.equal(validSetupPatch(p), false);
  assert.equal(validSetupPatch({ intervalMs: 300, showPose: false }), true);
});
test('proposal preview contains only changed values, with exact before values for undo', () => {
  const patch = changedValues(settings, { intervalMs: 300, showPose: true });
  assert.deepEqual(patch, { intervalMs: 300 });
  assert.deepEqual(previousValues(settings, patch), { intervalMs: 120 });
});
test('stale apply and stale undo are rejected, while unrelated edits are preserved', () => {
  const patch = { intervalMs: 300 };
  assert.equal(proposalConflicts(settings, settings, patch), false);
  assert.equal(proposalConflicts({ ...settings, intervalMs: 200 }, settings, patch), true);
  assert.equal(proposalConflicts({ ...settings, showBoxes: false }, settings, patch), false);
  const applied = { ...settings, ...patch };
  const before = previousValues(settings, patch);
  assert.equal(proposalConflicts(applied, applied, before), false);
  assert.equal(proposalConflicts({ ...applied, intervalMs: 400 }, applied, before), true);
});
