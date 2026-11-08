import { useId, useRef, useState } from 'react';
import { reviewEvent, type SafetyEvent } from '@/lib/store';
import { MAX_REVIEW_NOTE, canReview, reviewOutcome, HUMAN_OUTCOMES, type HumanOutcome, type ZoneReview as ReviewRecord, type ReviewAction, type ReviewStatus } from '@/lib/zone-records';
import { cn } from '@/lib/utils';

export const REVIEW_LABEL: Record<ReviewStatus, string> = { open: 'Awaiting review', reviewed: 'Reviewed', resolved: 'Resolved', dismissed: 'Dismissed' };
export const REVIEW_STYLE: Record<ReviewStatus, string> = {
  open: 'text-[hsl(var(--warn))] bg-[hsl(40_90%_95%)] ring-[hsl(36_80%_78%)]',
  reviewed: 'text-[hsl(var(--lens-deep))] bg-[hsl(234_80%_97%)] ring-[hsl(234_60%_84%)]',
  resolved: 'text-[hsl(var(--safe))] bg-[hsl(158_60%_95%)] ring-[hsl(158_50%_80%)]',
  dismissed: 'text-muted-foreground bg-white ring-[hsl(var(--rule))]',
};
export function ReviewBadge({ status, testId }: { status: ReviewStatus; testId?: string }) {
  return <span data-testid={testId} className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ring-1', REVIEW_STYLE[status])}>{REVIEW_LABEL[status]}</span>;
}
export const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const OUTCOME_LABEL: Record<HumanOutcome, string> = {
  'assistance-needed': 'Assistance needed', 'no-assistance-needed': 'No assistance needed', 'unable-to-verify': 'Unable to verify',
};

export function EventReview({ event }: { event: SafetyEvent }) {
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<HumanOutcome | ''>('');
  const baseline = useRef<{ review: ReviewRecord | null } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const uid = useId();
  const z = event.zone, review = event.review;
  if (event.kind === 'analysis') return null;
  const id = event.id, status = review?.status ?? 'open';
  const selectedOutcome = outcome || reviewOutcome(review);
  const beginDraft = () => { baseline.current ??= { review: review ?? null }; setSaved(null); };
  const act = (to: ReviewAction['status']) => {
    setSaved(null);
    if (to === 'resolved' && (!confirm || selectedOutcome === 'unable-to-verify')) { setError('Resolution requires explicit confirmation and cannot use an unable-to-verify outcome.'); return; }
    if (reviewEvent(id, to, note, Date.now(), { ...(outcome ? { outcome } : {}), confirmed: confirm, expectedReview: baseline.current ? baseline.current.review : review ?? null })) {
      setNote(''); setOutcome(''); baseline.current = null; setConfirm(false); setError(null); setSaved(`Saved as ${REVIEW_LABEL[to]}.`);
    }
    else setError('Not saved. Browser storage may be blocked, full or damaged, or this record changed in another tab. Your note is kept; check the storage notice, then retry.');
  };
  const terminal = status === 'resolved' || status === 'dismissed';
  return (
    <div className="space-y-4 break-words text-sm [overflow-wrap:anywhere]" data-testid={`zone-review-${id}`}>
      <div>
        <p className="eyebrow text-muted-foreground">Original observation</p>
        <p className="mt-1 text-xs text-muted-foreground">{event.source === 'demo' ? 'Saved simulation' : 'Saved camera observation'} · {event.kind === 'zone' ? 'Zone flag' : 'On-device rule observation'} · {new Date(event.ts).toLocaleString()}</p>
        {event.decision && <p className="mt-1 text-xs">Review subject: <strong>{event.decision.triggers[0]!.label}</strong> ({event.decision.triggers[0]!.personId}). This outcome and resolution apply only to this anonymous person episode.</p>}
        {z ? <>
        <p className="mt-1">{z.personLabel} was observed with the bottom-center of their box inside <strong className="font-medium">{z.zone.name}</strong> for {fmtSec(z.dwellMs)} (threshold {z.zone.dwellSec} s).</p>
        <p className="mt-1 text-xs text-muted-foreground">Timed from {z.timestampBasis === 'simulation' ? 'simulated' : 'decoded video'} frames at {new Date(event.ts).toLocaleString()}. A 2D image position, not a measured floor location.</p>
        </> : <p className="mt-1 text-xs text-muted-foreground">This check applies to the saved rule observation above, not a confirmed fall or injury. Original scores, temporary person labels and evidence remain unchanged.</p>}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2"><p className="eyebrow text-muted-foreground">Human review</p><ReviewBadge status={status} testId={`status-review-${id}`} /></div>
        <p className="mt-2 text-xs">Human outcome: <strong>{reviewOutcome(review) ? OUTCOME_LABEL[reviewOutcome(review)!] : 'Not recorded'}</strong></p>
        <p className="mt-1 text-xs text-muted-foreground">A recorded check does not assert a physical visit. Assistance needed does not mean assistance was delivered. Human entries are not machine-verified harm or model-training labels.</p>
        {review && review.actions.length > 0 ? (
          <ol className="mt-2 space-y-1.5 border-l border-[hsl(var(--rule))] pl-3">
            {review.actions.map((a, i) => <li key={i}><span className="font-mono text-xs text-muted-foreground">{new Date(a.at).toLocaleString()}</span> <span className="font-medium">{REVIEW_LABEL[a.status]}</span><span className="block text-xs">Outcome: {a.outcome ? OUTCOME_LABEL[a.outcome] : 'Not recorded with this action'}{a.confirmed ? ' · Human resolution confirmed' : ''}</span>{a.note && <span className="block whitespace-pre-wrap break-words text-muted-foreground">{a.note}</span>}</li>)}
          </ol>
        ) : <p className="mt-1 text-xs text-muted-foreground">Human check not recorded. Standing up, leaving, disappearing, a lower score or interrupted monitoring never closes this record.</p>}
      </div>
      {terminal ? <div className="text-xs text-muted-foreground"><p>This record is {REVIEW_LABEL[status].toLowerCase()} and can no longer be changed. Dismissal is not a verified or handled resolution.</p>{(note || outcome) && <p className="mt-2 whitespace-pre-wrap break-words">Unsaved draft (not saved): {outcome && OUTCOME_LABEL[outcome]} {note}</p>}</div> : (
        <div className="space-y-2.5">
          <label className="block text-xs text-muted-foreground" htmlFor={`${uid}-o`}>Human outcome (separate from workflow status)</label>
          <select id={`${uid}-o`} data-testid={`review-outcome-${id}`} value={outcome} onChange={(e) => { beginDraft(); setOutcome(e.target.value as HumanOutcome | ''); setConfirm(false); }} className="w-full rounded-lg border border-[hsl(var(--rule))] bg-white px-2.5 py-2">
            <option value="">{reviewOutcome(review) ? 'Keep recorded outcome' : 'Not recorded'}</option>
            {HUMAN_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          </select>
          <label className="block" htmlFor={`${uid}-n`}><span className="text-xs text-muted-foreground">Note (optional, saved with the next action)</span></label>
          <textarea id={`${uid}-n`} value={note} maxLength={MAX_REVIEW_NOTE} onChange={(e) => { beginDraft(); setNote(e.target.value); }} rows={2} data-testid={`review-note-${id}`}
            className="w-full rounded-lg border border-[hsl(var(--rule))] bg-white px-2.5 py-2" placeholder="Describe what you reviewed or what assistance is still needed. Avoid names." />
          <div className="flex justify-between text-[11px] text-muted-foreground"><span>{note || outcome ? 'Unsaved draft; save before leaving this view' : ''}</span><span className="font-mono tabular-nums">{note.length}/{MAX_REVIEW_NOTE}</span></div>
          {canReview(status, 'resolved') && (
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={confirm} onChange={(e) => { beginDraft(); setConfirm(e.target.checked); }} data-testid={`confirm-resolve-${id}`} className="mt-0.5 h-4 w-4 accent-[hsl(var(--lens))]" />
              <span>I confirm this {event.kind === 'zone' ? 'zone flag' : 'saved observation'} has been reviewed and any needed follow-up is handled. This does not assert a physical person-check or machine-verified safety.</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {canReview(status, 'reviewed') && <button type="button" onClick={() => act('reviewed')} data-testid={`button-review-${id}`} className="btn-primary px-3.5 py-2">{status === 'reviewed' ? 'Save follow-up check' : 'Mark reviewed'}</button>}
            {canReview(status, 'resolved') && <button type="button" onClick={() => act('resolved')} disabled={!confirm || selectedOutcome === 'unable-to-verify'} data-testid={`button-resolve-${id}`} className="btn-primary px-3.5 py-2 disabled:opacity-40">Resolve</button>}
            <button type="button" onClick={() => act('dismissed')} data-testid={`button-dismiss-${id}`} className="btn-ghost px-3.5 py-2">Dismiss</button>
          </div>
          {selectedOutcome === 'unable-to-verify' && <p className="text-xs text-muted-foreground">Unable to verify can be saved as a review, but cannot resolve the record. Record a later check with a different outcome before resolving.</p>}
        </div>
      )}
      <div aria-live="polite">
        {error && <><p role="alert" className="text-xs text-[hsl(var(--hot))]">{error}</p>{!terminal && <button type="button" onClick={() => { baseline.current = { review: review ?? null }; setConfirm(false); setError(null); }} className="mt-2 text-xs underline">Use latest review, keep draft</button>}</>}
        {saved && <p className="text-xs text-[hsl(var(--safe))]">{saved}</p>}
      </div>
    </div>
  );
}
export const ZoneReview = EventReview;
