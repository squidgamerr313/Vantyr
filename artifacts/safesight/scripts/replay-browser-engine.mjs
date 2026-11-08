/** Recorded-file adapter, real models/modules. Never a physical camera or React UI test. */
import { chromium } from '@playwright/test';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Development console messages can contain HMR URL tokens. Never retain queries.
const safeMessage = text => String(text).replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/g, value => {
  try { const url = new URL(value); return url.origin + url.pathname; }
  catch { return '[redacted URL]'; }
});
const flag = name => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--manifest') || !process.argv.includes('--output'))
  throw Error('Required: --manifest PATH --output NEW_PATH');
const manifestPath = resolve(flag('--manifest')), output = resolve(flag('--output'));
const insideGenerated = path => path.startsWith(resolve(root, 'generated-artifacts') + '/');
if (!insideGenerated(output) || !insideGenerated(manifestPath)) throw Error('Use generated-artifacts paths');
try { await access(output); throw Error('Output exists; choose a new name'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const manifestBytes = await readFile(manifestPath), manifest = JSON.parse(manifestBytes);
const suiteBytes = await readFile(resolve(root, 'docs/continuous-benchmark-v1.json'));
const suite = JSON.parse(suiteBytes);
if (manifest.suite_sha256 !== hash(suiteBytes) ||
    JSON.stringify(manifest.clips.map(c => c.source_id)) !== JSON.stringify(suite.recordings.map(r => r.source_id)) ||
    manifest.clips.some((c, i) => JSON.stringify(c.record) !== JSON.stringify(suite.recordings[i])))
  throw Error('Use the complete unchanged source/annotation matrix, not a selected subset');
const protocol = 'docs/safesight-browser-replay-protocol.md';
if (manifest.protocol_sha256 !== hash(await readFile(resolve(root, protocol))))
  throw Error('Protocol changed after preparation');
const appHtml = await readFile(resolve(root, 'artifacts/safesight/index.html'), 'utf8');
const connectPolicy = appHtml.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/?>/)?.[1];
if (!connectPolicy?.startsWith("connect-src 'self' ") || connectPolicy.includes('odml.pa.googleapis.com'))
  throw Error('App monitoring network policy is missing or allows vendor diagnostics');
const base = new URL(process.env.SAFESIGHT_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/`);
if (!base.pathname.endsWith('/')) base.pathname += '/';
const report = { version: 'browser-combination-v1', status: 'running', expected_clips: manifest.clips.length,
  manifest_sha256: hash(manifestBytes), protocol_sha256: manifest.protocol_sha256,
  code_sha256: {}, clips: [], aggregate: null, uploads: 0, blocked_requests: [], policy_violations: [], errors: [],
  limitations: ['Previously inspected correlated recordings; no action accuracy/safety guarantee.',
    'Recorded-file source token adapts srcObject ownership; not physical MediaStream behavior.',
    'Production modules composed in harness, not React Dashboard; UI journey verified separately.',
    'Artificial full-image zone controls are unscored; no independent zone/tool/identity truth.',
    'One shared warm model runtime across recordings; software SwiftShader, not Mac/Brave.',
    'Coverage is completion-time finite-sample interval estimation, not continuous ground truth.'] };
for (const name of ['vision', 'vision-lifecycle', 'owned-frame', 'vision-support', 'decoded-frame-probe',
  'monitoring-health', 'monitoring-inference', 'risk', 'person-tracking', 'person-geometry',
  'context-decision', 'context-check-records', 'check-outbox', 'store', 'zone-monitor',
  'storage-validation', 'overlay']) {
  const path = `artifacts/safesight/src/lib/${name}.ts`;
  report.code_sha256[path] = hash(await readFile(resolve(root, path)));
}
report.code_sha256[relative(root, fileURLToPath(import.meta.url))] = hash(await readFile(fileURLToPath(import.meta.url)));
report.code_sha256['artifacts/safesight/index.html'] = hash(Buffer.from(appHtml));
const persist = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
await writeFile(output, JSON.stringify(report) + '\n', { flag: 'wx' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const deadline = setTimeout(() => { console.error('Browser replay exceeded 25-minute deadline'); void browser.close(); }, 1500000);
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__networkPolicyViolations = [];
    addEventListener('securitypolicyviolation', event => {
      // No bodies, headers, URL queries or data: payloads are retained.
      let origin = 'non-network';
      try { const url = new URL(event.blockedURI);
        if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) origin = url.origin;
      } catch {}
      window.__networkPolicyViolations.push({ directive: event.effectiveDirective, blockedOrigin: origin });
    });
  });
  page.on('console', msg => { if (msg.type() === 'error') console.error(safeMessage(msg.text())); });
  await page.route('**/*', async route => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || /\/api\/safety\/analyze/.test(request.url())) {
      report.uploads++;
      const url = new URL(request.url());
      report.blocked_requests.push({ method: request.method(), origin: url.origin,
        path: url.pathname.slice(0, 160), resource: request.resourceType() });
      return route.abort();
    }
    return route.continue();
  });
  await page.route(new URL('__engine_replay_harness', base).href, route =>
    route.fulfill({ contentType: 'text/html', body: `<!doctype html><head><meta http-equiv="Content-Security-Policy" content="${connectPolicy}"><title>Recorded engine verification — not live</title></head>` }));
  await page.goto(new URL('__engine_replay_harness', base).href);
  if (await page.evaluate(() => localStorage.length || sessionStorage.length))
    throw Error('Harness storage was not empty before imports');
  await page.evaluate(async basePath => {
    const m = path => import(`${basePath}src/lib/${path}.ts`);
    const [vision, health, probe, inference, risk, decision, split, checks, store, zones, overlay, validation] =
      await Promise.all(['vision', 'monitoring-health', 'decoded-frame-probe', 'monitoring-inference', 'risk',
        'context-decision', 'context-check-records', 'check-outbox', 'store', 'zone-monitor', 'overlay', 'storage-validation'].map(m));
    const started = performance.now();
    const engine = await vision.createVisionEngine(() => {});
    window.__recordedReplay = { health, probe, inference, risk, decision, split, checks, store, zones, overlay, validation,
      engine, loadMs: performance.now() - started };
  }, base.pathname);
  report.environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent, browser: 'Chromium Linux; requested software SwiftShader',
    model: window.__recordedReplay.engine.diagnostics(), loadMs: window.__recordedReplay.loadMs,
    execution: 'main-thread; recorded file playback at 1x, one inference, no queued frames',
  }));
  report.environment.connectPolicy = connectPolicy;
  report.environment.browserVersion = browser.version();
  await persist();
  for (const clip of manifest.clips) {
    const file = resolve(root, clip.file);
    if (!insideGenerated(file) || hash(await readFile(file)) !== clip.playback_sha256) throw Error('Playback input changed');
    const mediaUrl = new URL('__engine_replay_input', base).href;
    await page.route(mediaUrl, route => route.fulfill({ path: file,
      contentType: file.endsWith('.webm') ? 'video/webm' : 'video/mp4' }));
    console.log('Browser combination:', clip.source_id);
    const result = await page.evaluate(async ({ url, clip }) => {
      const api = window.__recordedReplay;
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
      // This ONLY adapts the camera-specific ownership contract to a recorded file.
      // Do not spoof playback time, rVFC, dimensions, readiness or any model outputs.
      Object.defineProperty(video, 'srcObject', { value: Object.freeze({ recordedFile: true }) });
      document.body.append(video);
      const ready = new Promise((resolve, reject) => {
        video.addEventListener('loadeddata', resolve, { once: true });
        video.addEventListener('error', () => reject(Error(`Recorded decode failed: ${video.error?.message}`)), { once: true });
      });
      const timeout = new Promise((_, reject) => setTimeout(() => reject(Error('Recorded decode timeout')), 20000));
      await Promise.race([ready, timeout]);
      if (video.videoWidth !== clip.width || video.videoHeight !== clip.height ||
          Math.abs(video.duration - clip.container_duration_s) > .06)
        throw Error('Browser dimensions/container duration changed');
      const browserDuration = video.duration;
      if (!api.store.clearEvents() || !api.store.setPrefs(api.store.DEFAULT_PREFS)) throw Error('Fixture storage unavailable');
      const assessor = api.risk.createRiskAssessor(), layer = api.decision.createContextDecisionLayer();
      const zones = api.zones.createZoneMonitor();
      const reset = () => { assessor.reset(); layer.reset(); zones.reset(); };
      const monitor = api.health.createMonitoringHealth({ publish() {}, invalidate: reset });
      const probe = api.probe.createDecodedFrameProbe(video);
      const session = crypto.randomUUID(), startedAt = Date.now();
      const zone = { id: 'unscored-full-image', name: 'Unscored recorded zone control', rect: [0, 0, 1, 1], dwellSec: 4 };
      const overlay = document.createElement('canvas'); overlay.width = clip.width; overlay.height = clip.height;
      const sample = () => { const t = probe.read();
        monitor.sample(Number.isFinite(t), t, performance.now(), probe.diagnostics().observedAt); return t; };
      const poll = setInterval(sample, 250);
      const attempts = [];
      let previous = NaN;
      const endAt = performance.now() + (clip.duration_s + 90) * 1000;
      monitor.enter('waiting', performance.now());
      try {
        await video.play();
        while (!video.ended && video.currentTime < clip.duration_s) {
          if (video.error) throw Error(video.error.message);
          if (performance.now() > endAt) throw Error('Recorded playback deadline exceeded');
          const started = performance.now(), decoded = sample();
          const observedAt = probe.diagnostics().observedAt;
          if (!Number.isFinite(decoded) || decoded === previous || started - observedAt >= 2500) { await wait(20); continue; }
          previous = decoded; probe.admit();
          const { ticket, inference } = api.inference.beginMonitoredInference(api.engine, video, monitor, started, observedAt);
          const result = await inference;
          sample();
          if (video.ended || video.currentTime >= clip.duration_s) monitor.enter('stopped', performance.now());
          const admitted = monitor.complete(ticket, result.frameTimeMs, performance.now());
          const completedMedia = Math.min(video.currentTime, clip.duration_s);
          const attempt = { capturedMedia: result.frameTimeMs / 1000, completedMedia,
            ageMs: performance.now() - ticket.started, admitted, usable: false,
            stages: result.stages, savedCheckTimes: [], detections: result.detections.length };
          if (admitted) {
            const prefs = api.store.getPrefs();
            const filtered = { ...result, detections: result.detections.filter(d => d.confidence >= prefs.minConfidence) };
            const now = performance.now();
            const a = assessor.assess(filtered, clip.width, clip.height, now, { source: 'live' });
            const progress = zones.tick({ zone, sessionId: session, sessionStartedAt: startedAt, source: 'live',
              persons: a.tracking.persons, frameTimeMs: result.frameTimeMs, now });
            const decision = layer.decide({ result: filtered, tracking: a.tracking, width: clip.width, height: clip.height,
              now, source: 'live', sessionId: session, zone: { config: zone, progress },
              blockedReason: api.checks.getPendingChecks().length + a.tracking.persons.length > 50 ? 'Retry capacity exhausted' : undefined });
            attempt.usable = a.tracking.persons.some(p => p.status === 'tracked' && p.posture !== 'unavailable');
            for (const individual of api.split.individualCheckDecisions(decision)) {
              const saved = api.checks.saveCheck({ id: crypto.randomUUID(), ts: Date.now(), source: 'live', kind: 'risk',
                level: 'uncertain', score: null, evidence: [...individual.facts.map(f => f.description), ...individual.reasons],
                detections: filtered.detections.length, decision: individual, review: { status: 'open', actions: [] } });
              if (!saved) throw Error('Recorded check save failed');
              attempt.savedCheckTimes.push(Math.min(video.currentTime, clip.duration_s));
            }
            for (const observation of progress.triggers) {
              if (!api.store.addEvent({ source: 'live', kind: 'zone', level: 'uncertain', score: null,
                evidence: ['Artificial full-image recorded zone control; unscored, not danger truth'],
                detections: filtered.detections.length, zone: observation, review: { status: 'open', actions: [] } }))
                throw Error('Recorded zone control save failed');
            }
            api.overlay.drawOverlay(overlay.getContext('2d'), filtered, clip.width, clip.height,
              { boxes: true, pose: true, minConf: prefs.minConfidence, simulated: false, persons: a.tracking.persons });
          }
          attempts.push(attempt);
          await wait(Math.max(0, 120 - (performance.now() - started)));
        }
        const events = api.store.getEvents();
        if (!events.every(api.validation.validEvent)) throw Error('Invalid saved recorded event');
        const savedChecks = events.filter(e => e.decision);
        if (new Set(savedChecks.flatMap(e => e.decision.episodes)).size !== savedChecks.length)
          throw Error('Duplicate person-check episode');
        return { attempts, browser_container_duration_s: browserDuration, saved_checks: savedChecks.length,
          saved_zone_controls: events.filter(e => e.kind === 'zone').length, pending_checks: api.checks.getPendingChecks().length,
          decoded: probe.diagnostics() };
      } finally {
        monitor.enter('stopped', performance.now()); reset(); clearInterval(poll); probe.stop();
        video.pause(); video.removeAttribute('src'); video.load(); video.remove();
      }
    }, { url: mediaUrl, clip });
    report.clips.push({ ...clip, ...result });
    await persist();
    await page.unroute(mediaUrl);
  }
  await page.evaluate(() => window.__recordedReplay.engine.dispose());
  // Both identified destinations remain blocked: vendor diagnostics, and the
  // development-only Vite HMR localhost fallback (not an engine dependency).
  // Transportable non-read requests still fail the original zero gate.
  report.policy_violations = await page.evaluate(() => window.__networkPolicyViolations);
  if (report.policy_violations.some(v => v.directive !== 'connect-src' ||
      !['https://odml.pa.googleapis.com', 'wss://localhost:23777'].includes(v.blockedOrigin)))
    throw Error('Unexpected destination blocked by network policy');
  if (report.uploads) throw Error('Unexpected non-read/upload request');
  report.status = 'complete';
} catch (e) {
  report.status = 'failed'; report.errors.push(safeMessage(e.message)); process.exitCode = 1;
} finally {
  clearTimeout(deadline); await browser.close(); await persist();
}
