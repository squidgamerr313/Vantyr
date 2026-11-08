import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';
import type { SpeechCategory } from '@workspace/api-client-react';
import { useSpeechReview } from '@/hooks/use-speech-review';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ResponseEvent } from '@/lib/responses';

const CATEGORIES: Array<{ id: SpeechCategory; label: string; hint: string }> = [
  { id: 'possible_abuse', label: 'Possible abuse', hint: 'Insults or demeaning speech aimed at someone' },
  { id: 'possible_threat', label: 'Possible threat', hint: 'Statements that may express intent to harm' },
  { id: 'help_request', label: 'Help request', hint: 'Phrases that may be a call for help' },
  { id: 'profanity', label: 'Profanity', hint: 'Swearing alone; not an indicator of danger' },
];
const LABEL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label])) as Record<SpeechCategory, string>;

const PHASE: Record<string, { label: string; tone: string }> = {
  stopped: { label: 'Speech review off', tone: 'hsl(var(--muted-foreground))' },
  loading: { label: 'Preparing on-device model', tone: 'hsl(var(--warn))' },
  requesting: { label: 'Requesting microphone', tone: 'hsl(var(--warn))' },
  listening: { label: 'Listening (capturing chunk)', tone: 'hsl(var(--lens))' },
  processing: { label: 'Processing - capture paused', tone: 'hsl(var(--sim))' },
  unavailable: { label: 'Paused / unavailable', tone: 'hsl(var(--hot))' },
};

const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function SpeechReviewPanel({ onCue, compact = false }: { onCue?: (event: ResponseEvent) => void; compact?: boolean }) {
  const { state, categories, setCategories, start, stop, dismiss } = useSpeechReview();
  const sent = useRef(new Set<string>());
  const latestCallback = useRef(onCue); latestCallback.current = onCue;
  useEffect(() => {
    if (state.phase === 'stopped' || state.phase === 'unavailable') { sent.current.clear(); return; }
    for (const cue of state.cues) {
      if (sent.current.has(cue.id)) continue;
      sent.current.add(cue.id);
      if (cue.automaticResponseEligible && (cue.category === 'help_request' || cue.category === 'possible_threat')) latestCallback.current?.({
        id: `speech:${cue.id}`, kind: cue.category === 'help_request' ? 'voice-help' : 'voice-threat', at: cue.capturedAt, source: 'live',
      });
    }
  }, [state]);
  const [consentOpen, setConsentOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const active = ['loading', 'requesting', 'listening', 'processing'].includes(state.phase);
  const phase = PHASE[state.phase] ?? PHASE.stopped;

  const openConsent = () => { setAgreed(false); setConsentOpen(true); };
  const confirm = () => { if (!agreed) return; setConsentOpen(false); setAgreed(false); void start(); };
  const toggle = (id: SpeechCategory) =>
    setCategories(categories.includes(id) ? categories.filter(c => c !== id) : [...categories, id]);

  return (
    <article className="my-4 rounded-xl border border-[hsl(var(--rule))] bg-[hsl(var(--paper))] p-4" aria-labelledby="speech-review-title" data-testid="panel-speech-review">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow text-muted-foreground">Optional pilot / English only</p>
          <h2 id="speech-review-title" className="mt-1 text-lg font-bold">On-device speech review</h2>
        </div>
        {active ? (
          <button type="button" onClick={stop} className="ssd-btn ssd-btn-stop" data-testid="button-speech-stop">
            <Square size={14} aria-hidden="true" /> Stop speech review
          </button>
        ) : (
          <button type="button" onClick={openConsent} disabled={!categories.length} className="ssd-btn ssd-btn-ink" data-testid="button-speech-start">
            <Mic size={14} aria-hidden="true" /> Review consent and start
          </button>
        )}
      </div>

      {(!compact || active || state.phase === 'unavailable') && <div role="status" aria-live="polite" aria-atomic="true" className="mt-3 border-l-[3px] bg-[hsl(40_30%_95%)] px-3 py-2" style={{ borderColor: phase.tone }} data-testid="status-speech">
        <p className="flex items-center gap-2 text-sm font-semibold" data-testid="text-speech-phase" data-phase={state.phase}>
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-[2px]" style={{ background: phase.tone }} />
          {phase.label}
        </p>
        <p className="mt-1 break-words text-xs text-muted-foreground" data-testid="text-speech-message">{state.message}</p>
      </div>}

      <details open={compact ? undefined : true} className="mt-3" data-testid="speech-options">
      <summary className="cursor-pointer text-sm font-medium">Speech settings and cues · {state.cues.length} to review</summary>
      <p className="mt-3 text-xs text-muted-foreground" data-testid="text-speech-local">Local English transcription + experimental context screening over recent chunks, with conservative phrase gates. Audio and transcripts are not uploaded. First use downloads two models and runtime files; later sessions may use the browser cache. Not general abuse or intent detection.</p>
      <fieldset className="mt-3" data-testid="fieldset-speech-categories">
        <legend className="text-xs font-semibold">Cue categories</legend>
        <p className="text-xs text-muted-foreground">Changing a category stops any active session; restarting needs new consent.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORIES.map(c => {
            const on = categories.includes(c.id);
            return (
              <label key={c.id} className="ssd-toggle text-sm" data-on={on} title={c.hint}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(c.id)} aria-describedby={`speech-hint-${c.id}`} data-testid={`toggle-speech-${c.id}`} />
                <span className="ssd-toggle-box" aria-hidden="true">{on ? '\u2713' : ''}</span>
                {c.label}
                <span id={`speech-hint-${c.id}`} className="sr-only">{c.hint}</span>
              </label>
            );
          })}
        </div>
        {!categories.length && <p className="mt-2 text-xs" style={{ color: 'hsl(var(--warn))' }} data-testid="text-speech-no-categories">Select at least one category to start.</p>}
      </fieldset>

      <section className="mt-4" aria-labelledby="speech-cues-title">
        <h3 id="speech-cues-title" className="text-sm font-semibold">Session cues <span className="ssd-hist-n" data-testid="text-speech-cue-count">{state.cues.length}/12</span></h3>
        <p className="text-xs text-muted-foreground">Uncertain prompts for human review, not verdicts about any person. Cleared when the session stops. Not saved or exported.</p>
        {state.cues.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-[hsl(var(--rule))] p-3 text-xs text-muted-foreground" data-testid="text-speech-empty">
            {active ? 'No cues yet. Silence or abstentions add nothing.' : 'No session cues. Nothing is recorded while speech review is off.'}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="list-speech-cues">
            {state.cues.map(cue => (
              <li key={cue.id} className="rounded-lg border border-[hsl(var(--rule))] bg-[hsl(var(--paper))] p-3" data-testid={`card-speech-cue-${cue.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs">
                    <span className="font-mono uppercase tracking-wider" data-testid={`text-speech-cue-category-${cue.id}`}>Possible cue: {LABEL[cue.category]}</span>
                    <span className="ml-2 font-mono text-muted-foreground" data-testid={`text-speech-cue-time-${cue.id}`}>chunk at {fmt(cue.capturedAt)}</span>
                  </p>
                  <button type="button" onClick={() => dismiss(cue.id)} className="ssd-btn -mr-1 -mt-1 !min-h-[36px] !px-2" aria-label={`Dismiss ${LABEL[cue.category]} cue from ${fmt(cue.capturedAt)}`} data-testid={`button-speech-dismiss-${cue.id}`}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
                <blockquote className="mt-1 break-words border-l-2 border-[hsl(var(--rule))] pl-2 text-sm" data-testid={`text-speech-cue-excerpt-${cue.id}`}>"{cue.excerpt}"</blockquote>
                <p className="mt-1 break-words text-xs" data-testid={`text-speech-cue-explanation-${cue.id}`}>{cue.explanation}</p>
                {cue.contextStatus === 'uncertain' && <p className="mt-1 text-xs font-semibold">Context uncertain · review only · automatic responses withheld</p>}
                {cue.category === 'profanity' && <p className="mt-1 text-xs text-muted-foreground">Profanity alone does not indicate danger.</p>}
                <p className="mt-1 break-words text-xs text-muted-foreground" data-testid={`text-speech-cue-limitations-${cue.id}`}><b>Limitations:</b> {cue.limitations}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="ssd-fine" data-testid="text-speech-scope">
        No speaker identification. No camera frames are uploaded by this feature. It does not change visual risk or history; separately enabled responses can react to fresh help/threat cues.{' '}
        <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/docs#speech-review`} className="underline underline-offset-2" data-testid="link-speech-docs">How speech review works</a>
      </p>
      </details>

      <Dialog open={consentOpen} onOpenChange={o => { setConsentOpen(o); if (!o) setAgreed(false); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="dialog-speech-consent">
          <DialogHeader>
            <DialogTitle>Start speech review for this session?</DialogTitle>
            <DialogDescription>Consent applies to this session only. You will be asked again every time.</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm" data-testid="list-speech-disclosures">
            <li>Your microphone captures up to three seconds at a time for English transcription on this device. Audio and transcripts are not sent to Gemini or our server. There is no automatic cloud fallback.</li>
            <li>The first start downloads quantized Whisper Tiny English and MobileBERT NLI models (tens of megabytes each) and runtime files from Hugging Face and jsDelivr. Those hosts receive asset requests, including your IP address, not your microphone audio. Public model files may remain in the browser cache. The microphone stays off while both models prepare.</li>
            <li>Bystanders and background speech will be captured. Only start where everyone audible knows and has agreed, and where recording is permitted.</li>
            <li>Audio, transcripts and cues are session-memory only, never saved to history or exported. Stop clears evidence and terminates the local worker. Model caching does not save conversations.</li>
            <li>Processing uses your device CPU and may compete with camera inference. Listening pauses during processing; speech in those gaps is missed. Slow or unsupported devices fail visibly, without uploading instead.</li>
            <li>Up to three recent chunks are temporarily used for local context screening. A generic language model and conservative quotation/negation guards can still misunderstand speech or suppress genuine help. Model scores are not danger probabilities. No speaker identification or general abuse/intent recognition.</li>
            <li>This is not emergency monitoring. Cues require human review and do not change visual risk. Optional tone, spoken notice or minimal webhook responses require separate enablement below; audible responses stop microphone capture until you consent again.</li>
          </ul>
          <p className="text-xs text-muted-foreground">Categories: {categories.map(c => LABEL[c]).join(', ')}</p>
          <label className="flex min-h-[44px] items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="h-4 w-4" data-testid="checkbox-speech-consent" />
            I understand and consent for this session
          </label>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setConsentOpen(false)} className="ssd-btn" data-testid="button-speech-cancel">Cancel</button>
            <button type="button" onClick={confirm} disabled={!agreed || !categories.length} className="ssd-btn ssd-btn-ink" data-testid="button-speech-consent-start">
              <Mic size={14} aria-hidden="true" /> Start speech review
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
