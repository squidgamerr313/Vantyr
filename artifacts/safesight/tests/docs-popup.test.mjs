import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/docs.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/pages/docs.css', import.meta.url), 'utf8');

test('popup hides without unmounting the assistant or discarding proposal state', () => {
  assert.match(source, /hidden=\{!assistantOpen\}/);
  assert.match(source, /<Assistant onCite=\{reveal\} onClose=\{closeAssistant\}/);
  assert.doesNotMatch(source, /assistantOpen\s*&&\s*[\s\S]{0,180}<Assistant/);
  const close = source.slice(source.indexOf('const closeAssistant'), source.indexOf('const [open,'));
  assert.match(close, /setAssistantOpen\(false\)/);
  assert.doesNotMatch(close, /chat\.clear|setDraft|abort\(/);
});

test('popup has dialog ownership, Escape handling, return focus and bounded fixed placement', () => {
  assert.match(source, /role="dialog" aria-modal="false" aria-labelledby="assistant-title"/);
  assert.match(source, /aria-expanded=\{assistantOpen\} aria-controls="assistant" aria-haspopup="dialog"/);
  assert.match(source, /event\.key !== 'Escape'/);
  assert.match(source, /assistantLauncher\.current\?\.focus/);
  assert.match(css, /\.dc-assistant-popup\s*\{[^}]*position: fixed/);
  assert.match(css, /\.dc-assistant-popup\[hidden\]\s*\{\s*display: none/);
  assert.doesNotMatch(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*400px/);
});

test('citations close the popup for reading and all assistant safeguards remain present', () => {
  const reveal = source.slice(source.indexOf('const reveal'), source.indexOf('useEffect', source.indexOf('const reveal')));
  assert.match(reveal, /setAssistantOpen\(false\)/);
  assert.match(reveal, /openOne\(id\)/);
  for (const id of ['text-privacy-notice', 'button-proposal-apply', 'button-proposal-dismiss', 'button-chat-undo', 'button-chat-clear']) {
    assert.ok(source.includes(`data-testid="${id}"`));
  }
});
