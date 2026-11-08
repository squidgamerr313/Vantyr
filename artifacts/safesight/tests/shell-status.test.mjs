import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('../src/components/shell.tsx', import.meta.url), 'utf8');

test('shared navigation has no decorative API badge or health polling', () => {
  assert.doesNotMatch(shell, /Analysis API|HealthPill|status-api|useHealthCheck|getHealthCheckQueryKey|refetchInterval/);
  assert.doesNotMatch(shell, /Snapshot service, not monitoring health/);
});

test('removing API status retains navigation, content access and storage notices', () => {
  for (const path of ['/dashboard', '/events', '/settings', '/docs']) {
    assert.ok(shell.includes(`href: '${path}'`));
  }
  assert.match(shell, /Skip to content/);
  assert.match(shell, /<StorageNotice\s*\/>/);
  assert.match(shell, /VANTYR home/);
});
