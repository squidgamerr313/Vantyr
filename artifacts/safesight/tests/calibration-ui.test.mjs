import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const compile = text => ts.transpileModule(text, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const calibration = dataUrl(compile(readFileSync(new URL('../src/lib/calibration.ts', import.meta.url), 'utf8')));
const source = compile(readFileSync(new URL('../src/components/calibration-panel.tsx', import.meta.url), 'utf8'))
  .replace(/from ["']([^"']+)["']/g, (_, spec) => `from ${JSON.stringify(spec === '@/lib/calibration' ? calibration : pathToFileURL(require.resolve(spec)).href)}`);
const { CalibrationPanel } = await import(dataUrl(source));
const noop = () => {};
function controller(phase, draft, progress) {
  return { phase, draft, progress, message: '', label: 'scissors', split: 'train', consent: true,
    applied: false, groups: 3, publicCount: 96, capturing: false, requirement: null,
    evaluation: null, baselineEvaluation: null, prediction: null, videoRef: { current: null },
    counts: Object.fromEntries(['knife','scissors','remote','toothbrush','spoon','other-coco-object'].map(label => [label, {train:0,validation:0}])),
    setConsent:noop,setLabel:noop,setSplit:noop,start:noop,stop:noop,clear:noop,capture:noop,newView:noop,train:noop,test:noop,apply:noop,forget:noop };
}
test('completed worker training renders 100% after returning to collecting', () => {
  const html = renderToStaticMarkup(React.createElement(CalibrationPanel, {controller:controller('collecting',{},1),disabled:false}));
  assert.match(html, /role="progressbar"/); assert.match(html, /aria-valuenow="100"/); assert.match(html, /100%/);
});
test('cleared drafts have no lingering completion progress', () => {
  const html = renderToStaticMarkup(React.createElement(CalibrationPanel, {controller:controller('off',null,0),disabled:false}));
  assert.doesNotMatch(html, /role="progressbar"/);
});
