import { env, pipeline, type AutomaticSpeechRecognitionPipeline, type ZeroShotClassificationPipeline } from '@huggingface/transformers';
import { hasAudibleSignal } from './local-speech-rules';
import { CONTEXT_LABELS, CONTEXT_LIMITATIONS, contextualSpeechReview, createSpeechContext, SPEECH_CONTEXT_MODEL, SPEECH_CONTEXT_REVISION } from './speech-context';
import type { SpeechCategory } from '@workspace/api-client-react';

// The worker accepts PCM arrays, never audio URLs. Only public asset GETs are
// allowed: no transcript/audio POST, provider fallback, SDK diagnostics or beacons.
const assetFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), globalThis.location.href);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const allowed = url.origin === globalThis.location.origin ||
    url.hostname === 'huggingface.co' || url.hostname === 'cdn.jsdelivr.net';
  if (!allowed || method.toUpperCase() !== 'GET' || init?.body || (input instanceof Request && input.body)) throw new Error('Non-asset speech network request blocked');
  return assetFetch(input, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
};
env.fetch = globalThis.fetch;
env.allowLocalModels = false;
env.useBrowserCache = true; // Public model files only, never microphone evidence.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}
let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let classifier: ZeroShotClassificationPipeline | null = null;
const context = createSpeechContext();
let busy = false;
const send = (data: object) => globalThis.postMessage(data);
globalThis.onmessage = async ({ data }) => {
  if (busy) { send({ type: 'error' }); return; }
  busy = true;
  let samples: Float32Array | undefined;
  try {
    if (data.type === 'load') {
      transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
        revision: '2575352d61be1bf7225cf8f8b268a4678025fc58',
        device: 'wasm', dtype: 'q8', progress_callback: () => send({ type: 'progress' }),
      });
      classifier = await pipeline('zero-shot-classification', SPEECH_CONTEXT_MODEL, {
        revision: SPEECH_CONTEXT_REVISION, device: 'wasm', dtype: 'q8',
        progress_callback: () => send({ type: 'progress' }),
      });
      send({ type: 'ready' });
    } else if (data.type === 'review') {
      samples = data.samples;
      if (!transcriber || !classifier || !(samples instanceof Float32Array) || samples.length < 8000 || samples.length > 128000) throw new Error('Invalid local input');
      if (!hasAudibleSignal(samples)) {
        context.clear();
        send({ type: 'result', review: { status: 'silence', transcript: '', cues: [], limitations: CONTEXT_LIMITATIONS } });
      } else {
        const output = await transcriber(samples, { max_new_tokens: 64, do_sample: false });
        const text = Array.isArray(output) ? output[0]?.text ?? '' : output.text;
        const window = context.add(text, Date.now());
        const prediction = await classifier(window, [...CONTEXT_LABELS], { hypothesis_template: 'This speech is {}.', multi_label: false });
        if (Array.isArray(prediction)) throw new Error('Unexpected classifier result');
        send({ type: 'result', review: contextualSpeechReview(text, window, data.categories as SpeechCategory[], prediction) });
      }
    }
  } catch (error) {
    // Preparation happens before microphone access. Development-only diagnostics
    // exclude URLs, tokens and any inference inputs/transcripts.
    if (data.type === 'load' && import.meta.env.DEV) {
      const diagnostic = error instanceof Error ? error.message : 'Unknown model initialization failure';
      console.error('Local speech preparation:', diagnostic.replace(/https?:\/\/\S+/g, '[asset URL]').slice(0, 800));
    }
    send({ type: 'error' });
  }
  finally { samples?.fill(0); busy = false; }
};
