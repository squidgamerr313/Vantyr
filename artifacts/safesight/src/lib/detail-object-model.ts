import type { ObjectPrediction } from './detail-objects.ts';
export const DETAIL_OBJECT_MODEL = Object.freeze({
  id: 'efficientdet_lite2-int8-1',
  url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite',
  sha256: 'b3f50554cb0ea559e90328845f7d9ba4d13c8bff372914d24e06bc8bb72fa896',
});

export async function createDetailObjectModel(
  files: Parameters<typeof import('@mediapipe/tasks-vision').ObjectDetector.createFromOptions>[0],
  signal: AbortSignal = new AbortController().signal,
) {
  const { ObjectDetector } = await import('@mediapipe/tasks-vision');
  signal.throwIfAborted();
  const response = await fetch(DETAIL_OBJECT_MODEL.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('Detail object model download failed');
  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== DETAIL_OBJECT_MODEL.sha256) throw new Error('Detail object model integrity check failed; no fallback was loaded');
  const model = await ObjectDetector.createFromOptions(files, {
    baseOptions: { modelAssetBuffer: new Uint8Array(buffer), delegate: 'CPU' },
    runningMode: 'IMAGE', scoreThreshold: .2, maxResults: 30,
  });
  if (signal.aborted) { model.close(); signal.throwIfAborted(); }
  return {
    async detect(image: HTMLCanvasElement): Promise<ObjectPrediction[]> {
      return model.detect(image).detections.flatMap(d => {
        const category = d.categories[0], box = d.boundingBox;
        return category && box ? [{ class: category.categoryName, score: category.score,
          bbox: [box.originX, box.originY, box.width, box.height] as [number, number, number, number] }] : [];
      });
    },
    dispose: () => model.close(),
  };
}
