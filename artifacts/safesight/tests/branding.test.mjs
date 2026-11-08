import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE } from '@workspace/safesight-guide';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('all user-facing documentation uses VANTYR, including assistant reference material', () => {
  const content = JSON.stringify(GUIDE);
  assert.match(content, /VANTYR/);
  assert.doesNotMatch(content, /safe[\s-]?sight/i);
  const assistant = source('../../api-server/src/lib/setup-assistant.ts');
  assert.match(assistant, /You are VANTYR's documentation and local setup assistant/);
});

test('downloaded history and original-data backups use the current product name', () => {
  assert.match(source('../src/pages/events.tsx'), /a\.download = `vantyr-events-/);
  assert.match(source('../src/components/storage-notice.tsx'), /link\.download = `vantyr-original-/);
});

test('the simulation accessible label uses VANTYR', () => {
  const svg = source('../public/demo-scene.svg');
  assert.match(svg, /aria-label="Schematic workshop backdrop for the VANTYR simulation/);
  assert.doesNotMatch(svg, /safe[\s-]?sight/i);
});

test('walkthrough requests bypass previously cached old-brand media', () => {
  const player = source('../src/components/product-walkthrough.tsx');
  assert.match(player, /walkthrough\/\$\{name\}\?v=vantyr-/);
});

test('rebranding preserves stored data compatibility', () => {
  const store = source('../src/lib/store.ts');
  assert.match(store, /events: 'safesight\.events\.v1'/);
  assert.match(store, /prefs: 'safesight\.prefs\.v1'/);
});
