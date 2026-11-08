import { acquireVisionModels, createOwnedInference } from './vision-lifecycle.ts';
import { FEATURE_SIZE } from './calibration.ts';

export function calibrationCrop(source: CanvasImageSource, width: number, height: number, box?: readonly number[]) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('No decoded image available');
  const size = Math.min(width, height) * .65;
  const [x, y, w, h] = box ?? [(width - size) / 2, (height - size) / 2, size, size];
  if (![x, y, w, h].every(Number.isFinite) || w! <= 0 || h! <= 0) throw new Error('Invalid crop');
  const pad = box ? .12 * Math.max(w!, h!) : 0;
  const left = Math.max(0, Math.floor(x! - pad)), top = Math.max(0, Math.floor(y! - pad));
  const right = Math.min(width, Math.ceil(x! + w! + pad)), bottom = Math.min(height, Math.ceil(y! + h! + pad));
  if (right <= left || bottom <= top) throw new Error('Crop outside image');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 224;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Crop canvas unavailable');
  const scale = Math.min(224 / (right - left), 224 / (bottom - top));
  const rw = (right - left) * scale, rh = (bottom - top) * scale;
  context.fillStyle = 'rgb(124,116,104)'; context.fillRect(0, 0, 224, 224);
  context.drawImage(source, left, top, right - left, bottom - top, (224 - rw) / 2, (224 - rh) / 2, rw, rh);
  return canvas;
}

/** Public pretrained vision encoder, never an LLM. No camera or user uploads. */
export async function createCalibrationEncoder(signal: AbortSignal, insideVisionLease = false) {
  const release = insideVisionLease ? () => {} : await acquireVisionModels(signal);
  let model: import('@tensorflow/tfjs-layers').LayersModel | undefined;
  try {
    const tf = await import('@tensorflow/tfjs-core');
    await import('@tensorflow/tfjs-backend-webgl'); await import('@tensorflow/tfjs-backend-cpu');
    if (!insideVisionLease) {
      try { if (!await tf.setBackend('webgl')) throw new Error('WebGL unavailable'); await tf.ready(); }
      catch { await tf.setBackend('cpu'); await tf.ready(); }
    }
    signal.throwIfAborted();
    const layers = await import('@tensorflow/tfjs-layers');
    model = await layers.loadLayersModel('https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_1.0_224/model.json', { requestInit: { signal } });
    signal.throwIfAborted();
    const network = model;
    const output = network.getLayer('conv_pw_13_relu').output;
    if (Array.isArray(output)) throw new Error('Unexpected feature layer outputs');
    const outputName = output.name;
    let resolveClosed!: () => void;
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const owner = createOwnedInference<number[], [HTMLCanvasElement]>({
      async run(image) {
        const tensor = tf.tidy(() => {
          const input = tf.expandDims(tf.sub(tf.div(tf.cast(tf.browser.fromPixels(image), 'float32'), 127.5), 1), 0);
          const grid = network.execute(input, outputName) as import('@tensorflow/tfjs-core').Tensor4D;
          return tf.reshape(tf.mean(grid, [1, 2]), [FEATURE_SIZE]);
        });
        try {
          const values = Array.from(await tensor.data());
          owner.assertCurrent(); signal.throwIfAborted();
          if (values.length !== FEATURE_SIZE || values.some(n => !Number.isFinite(n))) throw new Error('Unexpected visual feature contract');
          const norm = Math.hypot(...values); if (!norm) throw new Error('Empty visual features');
          return values.map(n => n / norm);
        } finally { tensor.dispose(); }
      },
      release() {
        signal.removeEventListener('abort', abort);
        try { network.dispose(); } finally { release(); resolveClosed(); }
      },
    });
    const abort = () => owner.dispose();
    signal.addEventListener('abort', abort, { once: true });
    return { encode: owner.detect, dispose: async () => { owner.dispose(); await closed; } };
  } catch (error) { try { model?.dispose(); } finally { release(); } throw error; }
}
