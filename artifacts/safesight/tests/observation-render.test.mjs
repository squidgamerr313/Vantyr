import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { presentObservation, presentSavedObservation } from '../src/lib/observation-presentation.ts';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { createContextDecisionLayer } from '../src/lib/context-decision.ts';
import { individualCheckDecisions } from '../src/lib/context-check-records.ts';
import { person, peopleFrame } from './fixtures/people.mjs';

let server, ObservationAssessment, MonitoringStatus;
before(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  // Compile the real shared TSX component without a browser, app server or storage.
  server = await createServer({
    root, configFile: false, logLevel: 'silent',
    resolve: { alias: { '@': `${root}src` } },
    esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  ({ ObservationAssessment } = await server.ssrLoadModule('/src/components/observation-assessment.tsx'));
  ({ MonitoringStatus } = await server.ssrLoadModule('/src/components/monitoring-status.tsx'));
});
after(async () => { await server?.close(); });
const render = (presentation, compact = false) => renderToStaticMarkup(createElement(ObservationAssessment, { presentation, compact }));

test('each simultaneous saved check renders its own subject and episode, never another person as the leading observation', () => {
  const assessor = createRiskAssessor(), layer = createContextDecisionLayer();
  let decision;
  for (const t of [0, 1000, 2000]) {
    const result = peopleFrame([person(.25, { angle: 90 }), person(.75, { angle: 90 })], { time: t });
    const a = assessor.assess(result, 1000, 600, t);
    decision = layer.decide({ result, tracking: a.tracking, width: 1000, height: 600, now: t, source: 'live', sessionId: 'render-checks' });
  }
  const records = individualCheckDecisions(decision);
  assert.equal(records.length, 2);
  records.forEach((d, i) => {
    const p = presentSavedObservation({ kind: 'risk', source: 'live', decision: d, evidence: d.reasons, score: null, level: 'uncertain' });
    const html = render(p);
    assert.ok(p.observed[0].startsWith(`${d.triggers[0].label}:`));
    assert.match(html, /data-testid="check-subject"/);
    assert.ok(html.includes(d.triggers[0].episodeId));
    assert.ok(html.includes(d.triggers[0].label));
    assert.ok(!html.includes(`${records[1 - i].triggers[0].label}:`));
  });
});

test('shared UI orders evidence before score and exposes exact escaped original text in a native disclosure', () => {
  const p = presentObservation({ source: 'demo', score: 52, level: 'moderate', evidence: ['Original <unsafe> & 52'] });
  const html = render(p);
  const sections = ['section-observed', 'section-unknown', 'section-checks', 'text-risk-score'].map((id) => html.indexOf(`data-testid="${id}"`));
  assert.ok(sections.every((n, i) => n >= 0 && (i === 0 || n > sections[i - 1])));
  assert.match(html, /<details[^>]*data-testid="list-evidence"/);
  assert.match(html, /<summary/);
  assert.match(html, /Original &lt;unsafe&gt; &amp; 52/);
  assert.match(html, /not a probability of harm/);
  assert.doesNotMatch(html, /aria-live/);
  assert.match(html, /<h2[^>]*id=/);
});
test('saved camera and simulation render as historical, with missing legacy detail explicitly unavailable', () => {
  for (const source of ['live', 'demo']) {
    const event = { id: 'legacy', ts: 1000, kind: 'risk', source, score: 52, level: 'moderate', evidence: ['Old evidence'], detections: 1 };
    const before = JSON.stringify(event);
    const html = render(presentSavedObservation(event), true);
    assert.match(html, source === 'live' ? /Saved camera observation/ : /Saved simulation/);
    assert.match(html, /Saved, not live now/);
    assert.match(html, /Original text is retained unchanged/);
    assert.match(html, /measured durations are unavailable/);
    assert.doesNotMatch(html, /Live camera|Person 1:|2\.0 seconds/);
    assert.equal(JSON.stringify(event), before);
  }
});
test('stopped/waiting/unavailable UI never renders a low zero-score verdict', () => {
  for (const availability of ['stopped', 'waiting', 'unavailable', 'stale']) {
    const html = render(presentObservation({ availability }));
    assert.match(html, /No current rule score is available/);
    assert.match(html, /does not establish that the environment is safe/);
    assert.doesNotMatch(html, /data-testid="text-risk-score"|data-testid="status-risk-level"/);
  }
});
test('health changes have one atomic polite announcement and recovery is keyboard-accessible', () => {
  for (const phase of ['stopped', 'simulation', 'requesting', 'loading', 'waiting', 'fresh', 'stale', 'interrupted', 'error']) {
    const html = renderToStaticMarkup(createElement(MonitoringStatus, {
      health: { phase, reason: 'A concise status reason' }, restart() {},
    }));
    assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.equal((html.match(/aria-live=/g) ?? []).length, 1);
    assert.match(html, /A concise status reason/);
    if (['stale', 'interrupted', 'error'].includes(phase)) assert.match(html, /<button[^>]*>Restart camera<\/button>/);
    else assert.doesNotMatch(html, /<button/);
  }
});
