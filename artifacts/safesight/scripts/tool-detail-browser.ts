import * as tf from '@tensorflow/tfjs-core';
import * as coco from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
import { detailRegions, mapDetailPredictions, mergeDetailPredictions } from '../src/lib/detail-objects';
import { createDetailObjectModel } from '../src/lib/detail-object-model';
import { FilesetResolver } from '@mediapipe/tasks-vision';

/** Development-only reproduction. Never imported by the application. */
export async function benchmarkTools(fixtures: { file: string; label: string; box: number[]; at?: number }[]) {
  try { await tf.setBackend('webgl'); await tf.ready(); } catch { await tf.setBackend('cpu'); await tf.ready(); }
  const results: unknown[] = [];
  for (const base of ['lite_mobilenet_v2', 'mobilenet_v2', 'efficientdet_lite2'] as const) {
    const detector = base === 'efficientdet_lite2'
      ? await createDetailObjectModel(await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm'))
      : await coco.load({ base });
    try {
      for (const fixture of fixtures) {
        const url = `/@fs/path/to/vantyr/generated-artifacts/tool-detail-evaluation/${fixture.file}`;
        const canvas = document.createElement('canvas');
        if (fixture.at !== undefined) {
          const video = document.createElement('video'); video.muted = true; video.src = url;
          await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Video load failed')); });
          video.currentTime = fixture.at / 1000;
          await new Promise<void>((resolve, reject) => { video.onseeked = () => resolve(); video.onerror = () => reject(new Error('Video seek failed')); });
          canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d')!.drawImage(video, 0, 0);
          video.removeAttribute('src'); video.load();
        } else {
          const image = new Image(); image.src = url; await image.decode();
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d')!.drawImage(image, 0, 0);
        }
        const begin = performance.now();
        const full = await detector.detect(canvas, 20, .2);
        const fullMs = performance.now() - begin;
        const crops = [];
        let cropMs = 0;
        if (base !== 'lite_mobilenet_v2') {
          for (const region of detailRegions(full, canvas.width, canvas.height, 0)) {
            const crop = document.createElement('canvas'); crop.width = region[2]; crop.height = region[3];
            crop.getContext('2d')!.drawImage(canvas, ...region, 0, 0, region[2], region[3]);
            const start = performance.now(); crops.push(...mapDetailPredictions(await detector.detect(crop, 12, .2), region)); cropMs += performance.now() - start;
            crop.width = crop.height = 0;
          }
        }
        const shape = (predictions: typeof full) => predictions.filter(p => ['knife', 'scissors', 'spoon', 'toothbrush', 'remote'].includes(p.class))
          .map(p => ({ label: p.class, score: p.score, box: p.bbox.map((n, i) => n / (i % 2 === 0 ? canvas.width : canvas.height)) }));
        results.push({ fixture, base, fullMs, cropMs, full: shape(full), detailed: shape(mergeDetailPredictions([...full, ...crops])) });
        canvas.width = canvas.height = 0;
      }
    } finally { detector.dispose(); }
  }
  return { backend: tf.getBackend(), limitations: ['Known exposed benchmark originals; training overlap unknown. Not held-out accuracy.', 'Still/selected-frame diagnostic; no field action recognition or scissors recall claim.'], results };
}

/** Real object+pose operator check on a labelled still-image canvas stream. */
export async function smokeDetailEngine() {
  const { createVisionEngine } = await import('../src/lib/vision');
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
  const image = new Image(); image.src = '/@fs/path/to/vantyr/generated-artifacts/tool-detail-evaluation/knife.jpg'; await image.decode();
  const draw = () => {
    const context = canvas.getContext('2d')!; context.fillStyle = '#eee'; context.fillRect(0, 0, 640, 480);
    context.drawImage(image, 0, 25, 640, 426);
    context.fillStyle = '#111'; context.fillText(`SYNTHETIC OPERATOR CHECK — STILL IMAGE ${Date.now()}`, 5, 15);
  };
  draw(); const timer = setInterval(draw, 100);
  const stream = canvas.captureStream(10);
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
  const controller = new AbortController();
  let engine: Awaited<ReturnType<typeof createVisionEngine>> | undefined;
  try {
    await video.play();
    const statuses: string[] = [];
    engine = await createVisionEngine(status => statuses.push(status), controller.signal, { objectProfile: 'detail' });
    const results = [];
    for (let i = 0; i < 3; i++) {
      const result = await engine.detect(video, video.currentTime * 1000, performance.now());
      results.push({ latency: result.latency, objectProfile: result.objectProfile, objectPasses: result.objectPasses,
        poses: result.landmarks.length, frameTimeMs: result.frameTimeMs, stages: result.stages,
        labels: result.detections.map(d => ({ label: d.label, confidence: d.confidence })),
        withinBudget: result.latency < 2500 && !result.stages?.skippedPose });
    }
    return { statuses, diagnostics: engine.diagnostics?.(), results, synthetic: true, fieldAccuracyValidated: false };
  } finally {
    controller.abort(); engine?.dispose(); clearInterval(timer); stream.getTracks().forEach(t => t.stop());
    video.srcObject = null; canvas.width = canvas.height = 0;
  }
}
