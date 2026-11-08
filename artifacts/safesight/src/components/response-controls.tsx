import { useState } from 'react';
import { BellRing, Square, FlaskConical } from 'lucide-react';
import type { ResponsesController } from '@/hooks/use-responses';
import { RESPONSE_LABELS, RESPONSE_NOTICE, responsePayload, validateWebhook, type ResponseConfig, type ResponseKind } from '@/lib/responses';

const KINDS = Object.keys(RESPONSE_LABELS) as ResponseKind[];
const ACTIONS: Array<{ id: 'tone' | 'spoken' | 'webhook'; label: string; hint: string }> = [
  { id: 'tone', label: 'Local tone', hint: 'Moderate chime on this device, not a siren.' },
  { id: 'spoken', label: 'Spoken notice', hint: 'Fixed neutral sentence, local English voices only, no remote fallback.' },
  { id: 'webhook', label: 'Webhook', hint: 'Browser POST of minimal JSON metadata to your HTTPS endpoint.' },
];
const STATUS_TONE: Record<string, string> = {
  pending: 'hsl(var(--warn))', completed: 'hsl(var(--safe))', unconfirmed: 'hsl(var(--hot))', cancelled: 'hsl(var(--muted-foreground))',
};
const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function safeHost(url: string) {
  if (!url || validateWebhook(url)) return null;
  try { return new URL(url).hostname; } catch { return null; }
}

export function ResponseControls({ controller }: { controller: ResponsesController }) {
  const { config, update, armed, enable, stop, test, message, attempts } = controller;
  const [ack, setAck] = useState(false);
  const pending = attempts.some(a => a.status === 'pending');

  const change = (next: ResponseConfig) => { setAck(false); update(next); };
  const toggleKind = (k: ResponseKind) => change({ ...config, kinds: config.kinds.includes(k) ? config.kinds.filter(x => x !== k) : [...config.kinds, k] });
  const toggleAction = (a: 'tone' | 'spoken' | 'webhook') => change({ ...config, [a]: !config[a] });

  const webhookError = config.webhook ? validateWebhook(config.webhookUrl) : null;
  const host = config.webhook ? safeHost(config.webhookUrl) : null;
  const hasAction = config.tone || config.spoken || config.webhook;
  const blocked = !config.kinds.length || !hasAction || (config.webhook && (!!webhookError || !ack));
  const preview = responsePayload({ id: 'example-0000-test', kind: config.kinds[0] ?? 'camera-posture', at: Date.parse('2025-01-01T12:00:00Z'), source: 'test' });
  const tone = armed ? 'hsl(var(--lens))' : 'hsl(var(--muted-foreground))';

  return (
    <article className="my-4 rounded-xl border border-[hsl(var(--rule))] bg-[hsl(var(--paper))] p-4" aria-labelledby="responses-title" data-testid="responses-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow text-muted-foreground">Optional / off by default</p>
          <h2 id="responses-title" className="mt-1 text-lg font-bold">Response actions</h2>
        </div>
        <button type="button" onClick={stop} className="ssd-btn ssd-btn-stop" data-testid="responses-stop">
          <Square size={14} aria-hidden="true" /> Stop all{pending ? ' (in progress)' : ''}
        </button>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="mt-3 border-l-[3px] bg-[hsl(40_30%_95%)] px-3 py-2 transition-colors" style={{ borderColor: tone }} data-testid="status-responses">
        <p className="flex items-center gap-2 text-sm font-semibold" data-testid="text-responses-armed" data-armed={armed}>
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-[2px]" style={{ background: tone }} />
          {armed ? 'Enabled for this tab' : 'Off'}
        </p>
        <p className="mt-1 break-words text-xs text-muted-foreground" data-testid="text-responses-message">{message}</p>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Runs at most one batch per 60 seconds, for <b>new live cues only</b>. Older cues and simulations never trigger it. No guarantee in background or closed tabs; speech detection is experimental. No emergency or external dispatch is configured. Editing anything below disarms.
      </p>
      <p className="mt-2 text-xs font-medium" data-testid="text-response-unsupported-actions">Scissors/knife detections, stabbing motions, pushing and general malicious intent are not response triggers. Camera cues are limited to the two rules listed below.</p>

      <fieldset className="mt-3">
        <legend className="text-xs font-semibold">Cues that may trigger</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {KINDS.map(k => {
            const on = config.kinds.includes(k);
            return (
              <label key={k} className="ssd-toggle text-sm" data-on={on}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleKind(k)} data-testid={`toggle-response-kind-${k}`} />
                <span className="ssd-toggle-box" aria-hidden="true">{on ? '\u2713' : ''}</span>
                {RESPONSE_LABELS[k]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-3">
        <legend className="text-xs font-semibold">Actions</legend>
        <div className="mt-2 flex flex-col gap-2">
          {ACTIONS.map(a => {
            const on = config[a.id];
            return (
              <label key={a.id} className="ssd-toggle !items-start py-2 text-sm" data-on={on}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleAction(a.id)} aria-describedby={`resp-hint-${a.id}`} data-testid={`toggle-response-${a.id}`} />
                <span className="ssd-toggle-box mt-[3px] shrink-0" aria-hidden="true">{on ? '\u2713' : ''}</span>
                <span>
                  <span className="font-medium">{a.label}</span>
                  <span id={`resp-hint-${a.id}`} className="block text-xs text-muted-foreground">{a.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {(config.tone || config.spoken) && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="text-responses-audio-note">
            Spoken text: "{RESPONSE_NOTICE}" Any audio output ends active microphone consent to avoid feedback; restart speech review manually afterwards.
          </p>
        )}
      </fieldset>

      {config.webhook && (
        <div className="mt-3 rounded-lg border border-[hsl(var(--rule))] p-3">
          <label htmlFor="responses-webhook-url" className="text-xs font-semibold">Webhook URL (HTTPS, session memory only)</label>
          <input id="responses-webhook-url" type="password" autoComplete="off" spellCheck={false} value={config.webhookUrl}
            onChange={e => change({ ...config, webhookUrl: e.target.value })} placeholder="https://hooks.example.org/..."
            className="mt-1 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--paper))] px-3 font-mono text-sm"
            aria-invalid={!!webhookError && !!config.webhookUrl} data-testid="responses-webhook-url" />
          <p className="mt-1 text-xs" style={{ color: webhookError && config.webhookUrl ? 'hsl(var(--warn))' : 'hsl(var(--muted-foreground))' }} data-testid="text-responses-webhook-host">
            {config.webhookUrl ? (webhookError ?? `Destination domain: ${host}`) : 'Not saved, not logged. Cleared on reload.'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Sent directly from this browser; the endpoint must accept a CORS JSON POST. No server proxy, credentials, redirects or retries. A failed delivery may still have reached the destination.</p>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer font-medium">Exact payload (example)</summary>
            <pre className="mt-1 overflow-x-auto rounded-md bg-[hsl(40_30%_95%)] p-2 font-mono text-[11px]" data-testid="text-responses-payload">{JSON.stringify(preview, null, 2)}</pre>
            <p className="mt-1 text-muted-foreground">No transcripts, excerpts, images, audio, names or scores.</p>
          </details>
          <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4" checked={ack} onChange={e => { setAck(e.target.checked); if (!e.target.checked) stop(); }} disabled={!!webhookError} data-testid="checkbox-responses-webhook-ack" />
            I understand this minimal metadata leaves this device
          </label>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void enable()} disabled={armed || blocked} className="ssd-btn ssd-btn-ink" data-testid="responses-enable">
          <BellRing size={14} aria-hidden="true" /> {armed ? 'Enabled' : 'Enable for this tab'}
        </button>
        <button type="button" onClick={test} disabled={blocked || pending} className="ssd-btn" data-testid="responses-test">
          <FlaskConical size={14} aria-hidden="true" /> Send test
        </button>
      </div>
      <p className="ssd-fine">Send test preserves your existing enabled/off state; it never enables automatic actions on its own. Stop cancels tests too. Acknowledging or stopping is not a resolution and does not mean anyone is safe.</p>

      <section className="mt-4" aria-labelledby="responses-log-title">
        <h3 id="responses-log-title" className="text-sm font-semibold">Attempts <span className="ssd-hist-n" data-testid="text-responses-count">{attempts.length}/20</span></h3>
        {attempts.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-[hsl(var(--rule))] p-3 text-xs text-muted-foreground" data-testid="text-responses-empty">No attempts this session.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[hsl(var(--rule))] rounded-lg border border-[hsl(var(--rule))]" data-testid="list-responses-attempts">
            {attempts.map(a => (
              <li key={a.id} className="px-3 py-2 text-xs" data-testid={`row-response-attempt-${a.id}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
                  <span className="rounded px-1.5 py-0.5 uppercase tracking-wider" style={{ background: a.test ? 'var(--ssd-sim-wash)' : 'var(--ssd-lens-wash)', color: a.test ? 'hsl(var(--sim))' : 'hsl(var(--lens-deep))' }}>{a.test ? 'Test' : 'Live'}</span>
                  <span className="uppercase">{a.action}</span>
                  <span className="inline-flex items-center gap-1" style={{ color: STATUS_TONE[a.status] }} data-testid={`status-response-attempt-${a.id}`}>
                    <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: STATUS_TONE[a.status] }} />{a.status}
                  </span>
                  <span className="ml-auto text-muted-foreground">{fmt(a.at)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{RESPONSE_LABELS[a.kind]} · {a.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
