import { waitFor } from './async.ts';
import type { SpeechCategory, SpeechReview } from '@workspace/api-client-react';
import type { ContextualCue } from './speech-context.ts';

export type SpeechState = {
  phase: 'stopped' | 'loading' | 'requesting' | 'listening' | 'processing' | 'unavailable';
  message: string;
  cues: Array<ContextualCue & { id: string; capturedAt: number; limitations: string }>;
};
export const STOPPED_SPEECH: SpeechState = { phase: 'stopped', message: 'Off. No microphone capture or audio upload.', cues: [] };
export const DEFAULT_SPEECH_CATEGORIES: SpeechCategory[] = ['possible_abuse', 'possible_threat', 'help_request'];

/** A canonical, independently decodable mono 16-bit PCM WAV. */
export function encodeSpeechWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true));
  return bytes;
}

export type SpeechCapture = { close(): void };
export type SpeechCaptureFactory = (stream: MediaStream, chunk: (samples: Float32Array) => void, failed: () => void) => Promise<SpeechCapture>;

/** Foreground return never restarts capture; cleanup also invalidates pending ownership. */
export function bindSpeechLifecycle(
  page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
  navigation: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  stop: (message?: string, unavailable?: boolean, notify?: boolean) => void,
) {
  const hidden = () => { if (page.visibilityState !== 'visible') stop('Paused: page hidden. New consent is required to restart.', true); };
  const leave = () => stop('Stopped on navigation. New consent is required.');
  page.addEventListener('visibilitychange', hidden); navigation.addEventListener('pagehide', leave);
  return () => {
    page.removeEventListener('visibilitychange', hidden); navigation.removeEventListener('pagehide', leave);
    stop(undefined, false, false);
  };
}

export function createSpeechSession(options: {
  acquire: () => Promise<MediaStream>;
  capture: SpeechCaptureFactory;
  prepare?: (signal: AbortSignal, progress: (message: string) => void) => Promise<void>;
  release?: () => void;
  review: (audio: Uint8Array, categories: SpeechCategory[], signal: AbortSignal) => Promise<SpeechReview>;
  publish: (state: SpeechState) => void;
  visible: () => boolean;
  now?: () => number;
  permissionMs?: number;
  reviewMs?: number;
  gapMs?: number;
  prepareMs?: number;
}) {
  let epoch = 0, active: AbortController | null = null, stream: MediaStream | null = null, capture: SpeechCapture | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeTracks = () => {};
  let state = STOPPED_SPEECH;
  let seen: string[] = [];
  const publish = (next: SpeechState) => { state = next; options.publish(next); };
  const stop = (message = STOPPED_SPEECH.message, unavailable = false, notify = true) => {
    epoch++; active?.abort(); active = null; clearTimeout(timer);
    options.release?.();
    removeTracks(); removeTracks = () => {};
    capture?.close(); capture = null;
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    seen = [];
    state = { phase: unavailable ? 'unavailable' : 'stopped', message, cues: [] };
    if (notify) options.publish(state);
  };
  const start = async (categories: SpeechCategory[]) => {
    stop();
    if (!categories.length || !options.visible()) return;
    const owned = epoch, abort = new AbortController(); active = abort;
    let preparing = Boolean(options.prepare);
    const current = () => owned === epoch && !abort.signal.aborted && options.visible();
    const fail = () => { if (owned === epoch) stop('Paused / unavailable. Capture ended; start again with new consent. Camera monitoring is unaffected.', true); };
    publish({ phase: 'requesting', message: 'Requesting microphone permission. Stop cancels this session.', cues: [] });
    try {
      if (options.prepare) {
        publish({ phase: 'loading', message: 'Preparing local English model. Microphone is off. No cloud fallback.', cues: [] });
        await waitFor(options.prepare(abort.signal, message => {
          if (current()) publish({ ...state, phase: 'loading', message });
        }), abort.signal, options.prepareMs ?? 180000, 'Local model preparation');
        if (!current()) return;
        preparing = false;
        publish({ ...state, phase: 'requesting', message: 'Local model ready. Requesting microphone permission.' });
      }
      const acquisition = options.acquire();
      void acquisition.then(s => { if (!current()) s.getTracks().forEach(t => t.stop()); }, () => {});
      const acquired = await waitFor(acquisition, abort.signal, options.permissionMs ?? 30000, 'Microphone permission');
      if (!current()) return;
      stream = acquired;
      const tracks = acquired.getAudioTracks();
      if (!tracks.length) throw new Error('Missing microphone track');
      tracks.forEach(t => { t.addEventListener('ended', fail); t.addEventListener('mute', fail); });
      removeTracks = () => tracks.forEach(t => { t.removeEventListener('ended', fail); t.removeEventListener('mute', fail); });
      if (tracks.some(t => t.readyState === 'ended' || t.muted)) throw new Error('Interrupted microphone');
      const listen = async () => {
        if (!current()) return;
        tracks.forEach(t => { t.enabled = true; });
        const capturedAt = (options.now ?? Date.now)();
        publish({ ...state, phase: 'listening', message: 'Listening on device — capturing up to three seconds. Audio is not uploaded.' });
        let delivered = false;
        const opening = options.capture(acquired, samples => {
          if (!current() || delivered) { samples.fill(0); return; }
          delivered = true; clearTimeout(timer);
          // Run after capture factory has returned its close handle.
          setTimeout(() => { void process(samples); }, 0);
        }, fail);
        void opening.then(opened => { if (!current()) opened.close(); }, () => {});
        const opened = await waitFor(opening, abort.signal, 10000, 'Microphone capture startup');
        if (!current()) { opened.close(); return; }
        capture = opened;
        timer = setTimeout(fail, 10000);
        async function process(samples: Float32Array) {
          if (!current()) { samples.fill(0); return; }
          clearTimeout(timer);
          capture?.close(); capture = null;
          tracks.forEach(t => { t.enabled = false; });
          if (samples.length < 8000 || samples.length > 128000) { fail(); return; }
          publish({ ...state, phase: 'processing', message: 'Processing on device — microphone capture paused. Speech during this gap is not reviewed.' });
          try {
            const bytes = encodeSpeechWav(samples);
            samples.fill(0);
            let response: Promise<SpeechReview>;
            // The local adapter copies PCM synchronously. Wipe even if it throws.
            try { response = options.review(bytes, [...categories], abort.signal); }
            finally { bytes.fill(0); }
            const review = await waitFor(response, abort.signal, options.reviewMs ?? 25000, 'Speech review');
            if (!current()) return;
            const cues = [...state.cues];
            if (review.status === 'reviewed') for (const cue of review.cues) {
              const key = `${cue.category}:${cue.excerpt.toLowerCase().replace(/\W+/g, ' ').trim()}`;
              if (!categories.includes(cue.category) || seen.includes(key)) continue;
              seen = [...seen, key].slice(-80);
              cues.unshift({ ...cue, id: `${owned}-${capturedAt}-${cues.length}`, capturedAt, limitations: review.limitations });
            }
            publish({ ...state, cues: cues.slice(0, 12), message: review.status === 'reviewed' ? 'Chunk reviewed. Cues are uncertain and require human verification.' : `Abstained: ${review.status.replaceAll('_', ' ')}. No evidence inferred.` });
            // A visible gap, never a queue or replay; no automatic client retries.
            timer = setTimeout(() => { void listen().catch(fail); }, options.gapMs ?? 50);
          } catch {
            if (current()) stop('Local transcription failed or exceeded the device time limit. Microphone released. No cloud fallback; restart only with new consent.', true);
          }
        }
      };
      await listen();
    } catch {
      if (owned === epoch) stop(preparing
        ? 'Local model could not prepare: download, WebAssembly support or device resources unavailable. Microphone was not requested. No cloud fallback.'
        : 'Local model ready, but microphone unavailable or permission denied. Check microphone access and device support, then start again with new consent. No cloud fallback.', true);
    }
  };
  return { start, stop, dismiss: (id: string) => publish({ ...state, cues: state.cues.filter(c => c.id !== id) }) };
}
