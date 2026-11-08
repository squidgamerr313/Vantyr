/**
 * Real browser/model timings on explicitly synthetic decoded video, not model accuracy
 * or a physical-phone benchmark. Run from this package with the managed web service up.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.SAFESIGHT_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/`;
const output = resolve('../../generated-artifacts/pipeline');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  args: process.env.DISABLE_WEBGL === '1' ? ['--disable-webgl'] :
    ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const results = [];
const deadline = setTimeout(() => { console.error('Pipeline benchmark exceeded its 180-second deadline'); void browser.close(); }, 180000);
try {
  for (const rate of (process.env.RATES || '1,4').split(',').map(Number)) {
    const page = await browser.newPage();
    if (process.env.VIDEO_FILE) await page.route('**/__pipeline_input.webm', route =>
      route.fulfill({ path: resolve(process.env.VIDEO_FILE), contentType: 'video/webm' }));
    if (process.env.DISABLE_WEBGL === '1') {
      // Some managed Chromium builds re-enable software GL despite launch flags.
      // Reproduce an unavailable API, then assert the real engine selects CPU.
      await page.addInitScript(() => {
        for (const prototype of [HTMLCanvasElement.prototype, globalThis.OffscreenCanvas?.prototype].filter(Boolean)) {
          const original = prototype.getContext;
          prototype.getContext = function (kind, ...args) {
            return /webgl/i.test(kind) ? null : original.call(this, kind, ...args);
          };
        }
      });
    }
    await page.goto(base);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const result = await page.evaluate(async ({ frames, width, height, basePath, backend, yields, people, intervalMs, stallMs, noWebGL, videoInput }) => {
      const module = path => import(`${basePath}${path}`);
      const { createVisionEngine } = await module('src/lib/vision.ts');
      const { createRiskAssessor } = await module('src/lib/risk.ts');
      const { drawOverlay } = await module('src/lib/overlay.ts');
      const { createDecodedFrameProbe } = await module('src/lib/decoded-frame-probe.ts');
      const { createMonitoringHealth } = await module('src/lib/monitoring-health.ts');
      const { beginMonitoredInference } = await module('src/lib/monitoring-inference.ts');
      const { peopleFrame, person } = await module('tests/fixtures/people.mjs');
      const source = document.createElement('canvas'); source.width = width; source.height = height;
      const ctx = source.getContext('2d');
      let raf = 0, drawing = true;
      const draw = () => {
        ctx.fillStyle = '#e8e5df'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#504c68'; ctx.fillRect((performance.now() / 10) % width, 40, 50, height / 2);
        if (drawing) raf = requestAnimationFrame(draw);
      };
      draw();
      let media = null;
      if (videoInput) {
        media = document.createElement('video'); media.muted = true; media.loop = true;
        media.src = `${basePath}__pipeline_input.webm`;
        await media.play(); drawing = false; cancelAnimationFrame(raf);
        if (media.videoWidth !== width || media.videoHeight !== height) throw new Error('VIDEO_FILE dimensions must match WIDTH/HEIGHT');
      }
      const stream = media ? media.captureStream() : source.captureStream(30);
      const video = document.createElement('video'); video.muted = true; video.srcObject = stream;
      document.body.append(video); await video.play();
      const probe = createDecodedFrameProbe(video);
      const monitor = createMonitoringHealth({ publish() {}, invalidate() {} });
      const healthTimer = setInterval(() => {
        const t = probe.read(); monitor.sample(Number.isFinite(t), t, performance.now(), probe.diagnostics().observedAt);
      }, 100);
      const overlay = document.createElement('canvas'); overlay.width = width; overlay.height = height;
      const risk = createRiskAssessor();
      let engine;
      const samples = [], longTasks = [], heartbeat = [];
      let lastBeat = performance.now();
      const beat = setInterval(() => { const now = performance.now(); heartbeat.push(now - lastBeat - 25); lastBeat = now; }, 25);
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
      try { observer.observe({ type: 'longtask', buffered: false }); } catch {}
      try {
        const loading = performance.now();
        try {
          engine = await createVisionEngine(() => {}, undefined, { backend, yieldBetweenStages: yields });
        } catch (error) {
          if (!noWebGL || !/requires WebGL2/.test(error.message)) throw error;
          // A second failure must not hang waiting for a leaked model-session lease.
          try { await createVisionEngine(() => {}); } catch (again) {
            if (!/requires WebGL2/.test(again.message)) throw again;
          }
          return { unavailable: true, reason: error.message, samples: [], loadMs: performance.now() - loading,
            longTasks, userAgent: navigator.userAgent, source: 'unavailable-WebGL2 injection; no inference claimed' };
        }
        const loadMs = performance.now() - loading;
        const loadingLongTasks = longTasks.splice(0);
        const loadingHeartbeat = heartbeat.splice(0);
        const initialModelMemory = engine.diagnostics?.().memory;
        const decodeStart = performance.now();
        while (!Number.isFinite(probe.read())) {
          if (performance.now() - decodeStart > 5000) throw new Error('No decoded frames; captureStream is unavailable');
          await new Promise(r => setTimeout(r, 20));
        }
        const decodeReadyMs = performance.now() - decodeStart;
        monitor.enter('waiting', performance.now());
        let previous = NaN, skipped = 0;
        const frameDeadline = performance.now() + Math.max(30000, frames * 6000);
        for (let i = 0; i < frames;) {
          if (performance.now() > frameDeadline) throw new Error('Decoded-frame benchmark deadline exceeded');
          const decoded = probe.read();
          if (!Number.isFinite(decoded) || decoded === previous) { await new Promise(r => setTimeout(r, 20)); continue; }
          previous = decoded;
          const start = performance.now();
          const decode = probe.diagnostics();
          probe.admit();
          monitor.sample(true, decoded, start, decode.observedAt);
          const { ticket, inference } = beginMonitoredInference(engine, video, monitor, start, decode.observedAt);
          const result = await inference;
          if (stallMs) {
            // Deliberate post-inference main-thread overload, never labeled model cost.
            const until = performance.now() + stallMs;
            while (performance.now() < until) {}
          }
          const completed = performance.now();
          const time = probe.read(); monitor.sample(Number.isFinite(time), time, completed, probe.diagnostics().observedAt);
          const admitted = monitor.complete(ticket, result.frameTimeMs, completed);
          const trackingStart = performance.now();
          // Optional tracking-only load is explicitly synthetic, never model predictions.
          const trackingInput = people ? peopleFrame(Array.from({ length: people }, (_, n) =>
            person((n + 1) / (people + 1))), { width, height, time: result.frameTimeMs }) : result;
          let trackingMs = null;
          const assessment = admitted ? risk.assess(trackingInput, width, height, trackingStart,
            { source: 'live', onTrackingTiming: ms => { trackingMs = ms; } }) : null;
          const renderStart = performance.now();
          if (assessment) drawOverlay(overlay.getContext('2d'), trackingInput, width, height,
            { boxes: true, pose: true, minConf: .2, simulated: false, persons: assessment.tracking.persons });
          const renderEnd = performance.now();
          const quality = video.getVideoPlaybackQuality();
          samples.push({ index: i, ...result.stages, inferenceMs: result.latency, trackingMs,
            detectionCount: result.detections.length, personCount: result.detections.filter(d => d.label === 'person').length,
            poseCount: result.landmarks.length,
            assessmentMs: renderStart - trackingStart, overlayMs: renderEnd - renderStart,
            evidenceAgeMs: renderEnd - ticket.started, admitted, decodeMs: decode.decodeMs,
            mediaTimeMs: result.frameTimeMs, decodedFrames: quality.totalVideoFrames,
            decoderDropped: quality.droppedVideoFrames,
            heapBytes: performance.memory?.usedJSHeapSize ?? null, modelMemory: engine.diagnostics?.().memory ?? null });
          i++;
          skipped = probe.diagnostics().skipped;
          await new Promise(r => setTimeout(r, Math.max(0, intervalMs - (performance.now() - start))));
        }
        const diagnostics = engine.diagnostics?.() ?? null;
        engine.dispose();
        const afterDispose = engine.diagnostics?.().memory;
        // Exercise model recreation, bounded reentry and cancellation in this browser.
        engine = await createVisionEngine(() => {});
        const attempt = engine.detect(video);
        let busyRejected = false;
        try { await engine.detect(video); } catch { busyRejected = true; }
        engine.dispose();
        let cancelledRejected = false;
        try { await attempt; } catch { cancelledRejected = true; }
        if (!busyRejected || !cancelledRejected) throw new Error('Bounded cancellation contract failed');
        return { loadMs, decodeReadyMs, samples, longTasks, heartbeat, loadingLongTasks, loadingHeartbeat,
          skippedDecodedFrames: skipped, initialModelMemory, afterDispose,
          lifecycle: { busyRejected, cancelledRejected, afterSecondDispose: engine.diagnostics?.().memory },
          engine: diagnostics, userAgent: navigator.userAgent,
          source: videoInput ? 'local research video decoded into a MediaStream; real local models, not camera input' :
            'synthetic canvas captureStream, no people; real local object and pose models',
          syntheticTrackingPeople: people, width, height, intervalMs, stallMs,
          limitations: ['Not physical-phone performance', 'Evidence age starts at decoded-frame callback, not sensor exposure',
            'Overlay timing excludes React commit/compositor', 'Heap excludes WASM/GPU allocations',
            'Source production slows when main thread blocks', 'Raw playback quality counters are browser-dependent'] };
      } finally {
        engine?.dispose(); probe.stop(); clearInterval(healthTimer); clearInterval(beat); observer.disconnect();
        drawing = false; cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); video.srcObject = null; video.remove();
        if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
      }
    }, { frames: Number(process.env.FRAMES || 12), width: Number(process.env.WIDTH || 640), height: Number(process.env.HEIGHT || 360),
      basePath: new URL(base).pathname, backend: process.env.BACKEND || undefined, yields: process.env.YIELDS !== '0',
      people: Number(process.env.PEOPLE || 0), intervalMs: Number(process.env.INTERVAL_MS || 200), stallMs: Number(process.env.STALL_MS || 0),
      noWebGL: process.env.DISABLE_WEBGL === '1', videoInput: !!process.env.VIDEO_FILE });
    if (process.env.DISABLE_WEBGL === '1' && !result.unavailable)
      throw new Error('Unavailable-WebGL2 test unexpectedly claimed support; do not report fallback performance');
    results.push({ cpuThrottleRate: rate, emulation: rate !== 1,
      accelerator: process.env.DISABLE_WEBGL === '1' ? 'WebGL disabled' : 'ANGLE SwiftShader (software GPU)',
      cooperativeYields: process.env.YIELDS !== '0', ...result });
    console.log(JSON.stringify({ rate, loadMs: result.loadMs, sample: result.samples.at(-1), longTasks: result.longTasks.length }));
    await page.close();
  }
} finally { clearTimeout(deadline); await browser.close(); }
await writeFile(resolve(output, `${process.env.LABEL || 'pipeline'}.json`),
  JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2));
