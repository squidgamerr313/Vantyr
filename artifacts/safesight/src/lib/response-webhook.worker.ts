import { sendResponseWebhook } from './responses';

/** Isolated delivery boundary. No vision/speech SDKs, no media/transcripts.
 * An external-file worker has its own network context; do not broaden the
 * document's connect-src policy that deliberately blocks vendor telemetry. */
let used = false;
globalThis.onmessage = async ({ data }) => {
  if (used) return;
  used = true;
  try {
    if (typeof data.url !== 'string' || typeof data.event?.id !== 'string' ||
        !['camera-posture', 'camera-zone', 'voice-help', 'voice-threat'].includes(data.event.kind) ||
        !['live', 'test'].includes(data.event.source) || !Number.isFinite(data.event.at)) throw new Error('Invalid event');
    // sendResponseWebhook validates HTTPS destination and constructs the exact
    // allowlisted payload, never forwarding additional properties in data.event.
    await sendResponseWebhook(data.event, data.url, new AbortController().signal);
    globalThis.postMessage({ acknowledged: true });
  } catch { globalThis.postMessage({ acknowledged: false }); }
};
