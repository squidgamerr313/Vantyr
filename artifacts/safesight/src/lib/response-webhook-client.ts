import type { ResponseEvent } from './responses';
import { validateWebhook } from './responses';

export function deliverResponseWebhook(event: ResponseEvent, url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || validateWebhook(url)) { reject(new Error('Invalid or cancelled webhook')); return; }
    const worker = new Worker(new URL('./response-webhook.worker.ts', import.meta.url), { type: 'module' });
    const clean = () => { signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { clean(); reject(new Error('Delivery cancelled; transmission may already have occurred')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { clean(); reject(new Error('Webhook worker unavailable')); };
    worker.onmessage = ({ data }) => {
      clean();
      if (data.acknowledged) resolve();
      else reject(new Error('Delivery unconfirmed'));
    };
    try { worker.postMessage({ event, url }); } catch { clean(); reject(new Error('Delivery unavailable')); }
  });
}
