export type ResponseKind = 'camera-posture' | 'camera-zone' | 'voice-help' | 'voice-threat';
export type ResponseEvent = { id: string; kind: ResponseKind; at: number; source: 'live' | 'test' };
export type ResponseConfig = { kinds: ResponseKind[]; tone: boolean; spoken: boolean; webhook: boolean; webhookUrl: string };
export const DEFAULT_RESPONSES: ResponseConfig = { kinds: ['camera-posture', 'camera-zone', 'voice-help', 'voice-threat'], tone: false, spoken: false, webhook: false, webhookUrl: '' };
export const RESPONSE_LABELS: Record<ResponseKind, string> = {
  'camera-posture': 'Sustained horizontal posture', 'camera-zone': 'Configured zone dwell',
  'voice-help': 'Possible help request', 'voice-threat': 'Possible direct threat',
};
export const RESPONSE_NOTICE = 'An observation needs a human check. Please check the VANTYR monitor.';
export type ResponseAttempt = { id: string; kind: ResponseKind; at: number; action: 'tone' | 'spoken' | 'webhook'; status: 'pending' | 'completed' | 'unconfirmed' | 'cancelled'; detail: string; test: boolean };

export function cameraResponseReadiness(source: 'live' | 'demo' | 'off', fresh: boolean, labels: readonly string[], postureCheck: boolean) {
  if (source === 'off') return { input: 'Camera stopped. No camera cue can trigger.', tools: 'Tool labels unavailable while the camera is stopped.' };
  if (source === 'demo') return { input: 'Scripted simulation. Automatic live responses are excluded.', tools: 'Simulation labels are not real-camera detections.' };
  if (!fresh) return { input: 'Fresh camera evidence unavailable. No current camera assessment.', tools: 'Tool labels withheld because the frame is unavailable or stale.' };
  const tools = ['scissors', 'knife'].map(label => `${label}: ${labels.includes(label) ? 'label detected' : 'not labelled in this frame'}`).join(' · ');
  return {
    input: postureCheck
      ? 'Horizontal-posture check active. A response is considered once per new episode, not on every frame.'
      : 'No current horizontal-posture check. Configured zone dwell can separately supply a new cue.',
    tools: `${tools}. Missing labels do not establish that no tool is present.`,
  };
}

export function validateWebhook(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) return 'Use an HTTPS endpoint on port 443, without URL credentials or a fragment.';
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /\.(localhost|local|internal|test|invalid)$/.test(host) || host === 'localhost') return 'Use a public HTTPS hostname, not a local address or IP literal.';
    return null;
  } catch { return 'Enter a valid HTTPS webhook URL.'; }
}

/** No person/zone names, quotes, transcript, scores, recordings or images. */
export function responsePayload(event: ResponseEvent) {
  return { version: 1, eventId: event.id, eventType: event.kind, capturedAt: new Date(event.at).toISOString(), source: event.source, humanReviewRequired: true };
}

/** Session-only ownership, freshness, deduplication and a global 60s cooldown. */
export function createResponseGate() {
  let armedAt: number | null = null, last = -Infinity;
  let seen = new Set<string>();
  let reason = '';
  return {
    reason: () => reason,
    arm(now: number) { armedAt = now; last = -Infinity; seen = new Set(); },
    disarm() { armedAt = null; seen.clear(); },
    admit(event: ResponseEvent, config: ResponseConfig, now: number, test = false) {
      if (!test && (armedAt === null || event.source !== 'live' || event.at < armedAt || now - event.at > 10000 || now < event.at)) {
        reason = 'Response withheld: cue is old, simulated, outside this enablement or not fresh enough (10-second limit).'; return false;
      }
      if (!config.kinds.includes(event.kind)) { reason = 'Response withheld: this cue type is not selected.'; return false; }
      if (seen.has(event.id)) { reason = 'Response withheld: this cue was already handled.'; return false; }
      seen.add(event.id);
      if (seen.size > 200) seen = new Set([...seen].slice(-100));
      if (now - last < 60000) { reason = 'Response withheld: 60-second cooldown. This cue will not be queued or retried.'; return false; }
      reason = '';
      last = now; return true;
    },
  };
}

export async function sendResponseWebhook(event: ResponseEvent, url: string, signal: AbortSignal, send: typeof fetch = fetch) {
  if (validateWebhook(url)) throw new Error('Invalid webhook');
  const result = await send(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(responsePayload(event)), signal,
    mode: 'cors', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
  });
  if (!result.ok) throw new Error('Webhook did not acknowledge delivery');
}
