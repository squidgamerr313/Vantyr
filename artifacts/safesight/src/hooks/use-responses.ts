import { useCallback, useEffect, useRef, useState } from 'react';
import { createResponseGate, DEFAULT_RESPONSES, validateWebhook, type ResponseAttempt, type ResponseConfig, type ResponseEvent } from '@/lib/responses';
import { responseSpoken, responseTone } from '@/lib/response-audio';
import { armAudio } from '@/lib/audio';
import { deliverResponseWebhook } from '@/lib/response-webhook-client';

export function useResponses() {
  const [config, setConfig] = useState<ResponseConfig>(DEFAULT_RESPONSES);
  const [armed, setArmed] = useState(false);
  const [attempts, setAttempts] = useState<ResponseAttempt[]>([]);
  const [message, setMessage] = useState('Off. Configure and explicitly enable responses for this tab.');
  const gate = useRef(createResponseGate());
  const current = useRef({ config, armed }); current.current = { config, armed };
  const active = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  const ownership = useRef(0);
  const stop = useCallback(() => {
    ownership.current++;
    current.current.armed = false; gate.current.disarm();
    active.current.forEach(a => a.abort()); active.current.clear();
    if (mounted.current) { setArmed(false); setMessage('Responses stopped. No queued actions or automatic restart. This does not resolve any observation.'); }
  }, []);
  const update = (next: ResponseConfig) => { stop(); setConfig(next); };
  const enable = async () => {
    const owned = ownership.current;
    if (!config.kinds.length || !(config.tone || config.spoken || config.webhook)) { setMessage('Choose at least one cue and one response.'); return; }
    if (config.webhook && validateWebhook(config.webhookUrl)) { setMessage(validateWebhook(config.webhookUrl)!); return; }
    if (config.tone) {
      const failure = await armAudio();
      if (failure) { setMessage(failure); return; }
    }
    if (!mounted.current || owned !== ownership.current || document.visibilityState !== 'visible') return;
    gate.current.arm(Date.now()); current.current.armed = true; setArmed(true);
    setMessage('Enabled for NEW live cues only. One response batch per 60 seconds. Simulations and old cues cannot trigger it.');
  };
  const execute = useCallback((event: ResponseEvent, test = false) => {
    const selected = current.current.config;
    if (!test && !current.current.armed) return false;
    if (test && active.current.size) { setMessage('Wait for the current test or press Stop.'); return true; }
    // Manual tests have separate ownership/cooldown and cannot alter the live
    // gate or its existing operator enablement.
    const admission = test ? createResponseGate() : gate.current;
    if (!admission.admit(event, selected, Date.now(), test)) {
      setMessage(admission.reason()); return current.current.armed;
    }
    const actions = (['tone', 'spoken', 'webhook'] as const).filter(action => selected[action]);
    if (!actions.length) { setMessage('Select an action before testing.'); return true; }
    // Audible output could feed back into the microphone. End speech consent
    // first; the operator must explicitly restart after the notice.
    if (selected.tone || selected.spoken) window.dispatchEvent(new Event('vantyr:response-audio'));
    for (const action of actions) {
      const id = crypto.randomUUID(), controller = new AbortController(); active.current.add(controller);
      const entry: ResponseAttempt = { id, kind: event.kind, at: Date.now(), action, status: 'pending', detail: 'In progress', test };
      setAttempts(old => [entry, ...old].slice(0, 20));
      const timeout = setTimeout(() => controller.abort(), action === 'webhook' ? 6000 : 12000);
      const run = action === 'tone' ? responseTone(controller.signal)
        : action === 'spoken' ? responseSpoken(controller.signal)
        : deliverResponseWebhook(event, selected.webhookUrl, controller.signal);
      void run.then(() => {
        if (mounted.current) setAttempts(old => old.map(a => a.id === id ? { ...a, status: controller.signal.aborted ? 'cancelled' : 'completed', detail: controller.signal.aborted ? 'Stopped; an already transmitted webhook cannot be recalled.' : action === 'webhook' ? 'Endpoint acknowledged the request; downstream action is not verified.' : 'Playback completed; this does not confirm anyone heard it.' } : a));
      }, () => {
        if (mounted.current) setAttempts(old => old.map(a => a.id === id ? { ...a, status: controller.signal.aborted ? 'cancelled' : 'unconfirmed', detail: action === 'webhook' ? 'Delivery unconfirmed (network, CORS, timeout or rejection). No retry. A transmitted request cannot be recalled.' : 'Playback unavailable, blocked or stopped. No cloud voice fallback.' } : a));
      }).finally(() => { clearTimeout(timeout); active.current.delete(controller); });
    }
    return true;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.visibilityState !== 'visible') stop(); };
    const leave = () => stop();
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', leave);
    return () => { mounted.current = false; stop(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); };
  }, [stop]);
  return { config, update, armed, enable, stop, attempts, message, execute,
    test: async () => {
      const owned = ++ownership.current;
      if (current.current.config.tone) {
        const failure = await armAudio();
        if (failure) { setMessage(failure); return; }
      }
      if (!mounted.current || ownership.current !== owned || document.visibilityState !== 'visible') return;
      setMessage(current.current.armed
        ? 'Test requested. Automatic responses remain enabled for new supported live cues.'
        : 'Test requested only. Automatic responses remain OFF; select Enable for this tab afterward if wanted.');
      execute({ id: crypto.randomUUID(), kind: current.current.config.kinds[0] ?? 'camera-posture', at: Date.now(), source: 'test' }, true);
    },
  };
}
export type ResponsesController = ReturnType<typeof useResponses>;
