import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function elements(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = [];
  function walk(node, parents = []) {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const attributes = opening.attributes.properties;
      const get = name => attributes.find(a => ts.isJsxAttribute(a) && a.name.getText(file) === name);
      const testId = get('data-testid')?.initializer;
      const entry = { tag: opening.tagName.getText(file), id: testId && ts.isStringLiteral(testId) ? testId.text : null,
        get, parents, position: node.getStart(file) };
      result.push(entry);
      ts.forEachChild(node, child => walk(child, [...parents, entry]));
    } else ts.forEachChild(node, child => walk(child, parents));
  }
  walk(file);
  return { result, source };
}
const dashboard = elements('../src/pages/dashboard.tsx');
const speech = elements('../src/components/speech-review.tsx');
const find = id => dashboard.result.find(e => e.id === id);

test('research panels remain mounted inside a default-closed native disclosure', () => {
  const advanced = find('advanced-disclosure');
  assert.equal(advanced.tag, 'details');
  assert.equal(advanced.get('open'), undefined);
  assert.equal(advanced.get('onToggle'), undefined);
  for (const name of ['ToolMotionPanel', 'CalibrationPanel', 'TrackingEvidence', 'CandidateAvailability']) {
    const all = dashboard.result.filter(e => e.tag === name);
    assert.equal(all.length, 1, name);
    assert.ok(all[0].parents.includes(advanced), `${name} belongs in Advanced / Research`);
  }
  assert.ok(find('session-rule-history').parents.includes(advanced));
});
test('camera and actual recent events precede optional speech/configuration', () => {
  const camera = find('section-camera'), optional = find('optional-monitoring-tools');
  assert.ok(camera.position < optional.position);
  assert.ok(dashboard.result.find(e => e.tag === 'RecentReviewEvents').position < optional.position);
  assert.ok(!find('section-observation').parents.includes(find('advanced-disclosure')));
  assert.ok(!find('responses-disclosure').get('open'));
  for (const id of ['button-stop-response-actions', 'button-stop-calibration-camera']) {
    assert.ok(!find(id).parents.includes(find('advanced-disclosure')), `${id} stays accessible outside research`);
  }
  assert.match(dashboard.source, /const events = useEvents\(\)/);
  assert.match(dashboard.source, /const recent = events\.slice\(0, 5\)/);
  assert.match(dashboard.source, /An empty list does not mean the scene is safe/);
});
test('speech stop, active status and consent dialog cannot be hidden by speech options', () => {
  const options = speech.result.find(e => e.id === 'speech-options');
  for (const id of ['button-speech-stop', 'status-speech', 'dialog-speech-consent']) {
    const control = speech.result.find(e => e.id === id);
    assert.ok(control, id);
    assert.ok(!control.parents.includes(options), `${id} must stay outside optional settings`);
  }
  assert.match(speech.source, /!compact \|\| active \|\| state\.phase === 'unavailable'/);
});
test('default model and input freshness admission remain explicit', () => {
  assert.match(dashboard.source, /useState<ObjectProfile>\('balanced'\)/);
  assert.match(dashboard.source, /const liveReady = mode === 'live' && health\.phase === 'fresh'/);
  assert.match(dashboard.source, /if \(d instanceof HTMLDetailsElement\) d\.open = true/);
});
