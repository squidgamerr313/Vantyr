import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('full Monitor tree places session scores after observations in DOM and responsive grid order', () => {
  const text = readFileSync(new URL('../src/pages/dashboard.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('dashboard.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let assessment, history;
  const scoreDisplays = [];
  const attr = (tag, name) => tag.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.text === name)?.initializer;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'ObservationAssessment') assessment = node;
    if (ts.isJsxElement(node)) {
      const id = attr(node.openingElement, 'data-testid');
      if (id && ts.isStringLiteral(id) && id.text === 'session-rule-history') history = node;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'score') {
      let parent = node.parent;
      while (parent && !ts.isJsxExpression(parent)) parent = parent.parent;
      if (parent) scoreDisplays.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(assessment && history);
  const aside = assessment.parent;
  assert.equal(aside.openingElement.tagName.getText(file), 'aside');
  assert.equal(history.parent, aside.parent, 'history must follow the entire assessment column, not sit earlier in the camera column');
  assert.ok(history.pos > aside.end);
  assert.ok(scoreDisplays.every((n) => n.pos > assessment.end), 'no viewport/earlier JSX may display a rule score');
  assert.match(attr(aside.openingElement, 'className').text, /\border-2\b/);
  const classes = attr(history.openingElement, 'className').text;
  assert.match(classes, /\border-3\b/);
  assert.match(classes, /\bxl:col-span-2\b/, 'desktop history gets a later full-width grid row');
});
