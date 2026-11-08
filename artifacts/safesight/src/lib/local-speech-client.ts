import type { SpeechCategory, SpeechReview } from '@workspace/api-client-react';
import { decodeLocalWav } from './local-speech-rules.ts';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

/** One worker per consented session, no microphone/model work before prepare. */
export function createLocalSpeechClient(createWorker: () => WorkerPort) {
  let worker: WorkerPort | null = null;
  let pending: { resolve(value: SpeechReview | void): void; reject(error: Error): void; progress?: (message: string) => void } | null = null;
  const close = () => {
    worker?.terminate(); worker = null;
    const previous = pending; pending = null;
    previous?.reject(new Error('Local speech stopped'));
  };
  const request = (message: object, signal: AbortSignal, progress?: (message: string) => void, transfer: Transferable[] = []) => {
    if (signal.aborted || !worker || pending) return Promise.reject(new Error('Local speech unavailable'));
    return new Promise<SpeechReview | void>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener('abort', abort);
      const abort = () => close();
      pending = { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); }, progress };
      signal.addEventListener('abort', abort, { once: true });
      try { worker!.postMessage(message, transfer); } catch { close(); }
    });
  };
  return {
    close,
    async prepare(signal: AbortSignal, progress: (message: string) => void) {
      close();
      const owned = createWorker();
      worker = owned;
      owned.onmessage = ({ data }) => {
        if (worker !== owned) return;
        if (data.type === 'progress') { pending?.progress?.('Downloading / preparing local English model. Microphone is off.'); return; }
        const previous = pending; pending = null;
        if (data.type === 'error') { previous?.reject(new Error('Local model unavailable')); close(); }
        else previous?.resolve(data.type === 'ready' ? undefined : data.review);
      };
      owned.onerror = () => { if (worker === owned) close(); };
      await request({ type: 'load' }, signal, progress);
    },
    review(bytes: Uint8Array, categories: SpeechCategory[], signal: AbortSignal): Promise<SpeechReview> {
      const samples = decodeLocalWav(bytes);
      return request({ type: 'review', samples, categories }, signal, undefined, [samples.buffer]) as Promise<SpeechReview>;
    },
  };
}
