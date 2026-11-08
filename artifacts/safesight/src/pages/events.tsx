import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Trash2, ChevronDown, Sparkles, ShieldAlert, Square } from 'lucide-react';
import { AppShell, LevelBadge, SourceBadge, PageHeader } from '@/components/shell';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useEvents, deleteEvent, clearEvents, loadDemoEvents } from '@/lib/store';
import { isExampleEvent } from '@/lib/demo-events';
import { cn } from '@/lib/utils';
import { StateIllustration } from '@/components/illustrations';
import { TrackingEvidence } from '@/components/tracking-evidence';
import { ObservationAssessment } from '@/components/observation-assessment';
import { presentSavedObservation } from '@/lib/observation-presentation';
import { useZoneOutbox, retryZoneFlag } from '@/lib/zone-outbox';
import { ZoneUnsaved } from '@/components/zone-unsaved';
import { EventReview, ReviewBadge } from '@/components/zone-review';
import { ZoneSessionSummary } from '@/components/zone-session-summary';
import { CheckUnsaved } from '@/components/check-unsaved';

type F = 'all' | 'live' | 'demo' | 'analysis' | 'zone';

export default function Events() {
  const events = useEvents();
  const unsaved = useZoneOutbox();
  const [filter, setFilter] = useState<F>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [clearError, setClearError] = useState(false);
  const [demoNotice, setDemoNotice] = useState<{ text: string; error: boolean } | null>(null);
  const loadExamples = () => {
    const result = loadDemoEvents();
    setDemoNotice({
      text: result.error ?? (result.added ? `Added ${result.added} demo examples. Existing history was preserved.` : 'All demo examples are already loaded.'),
      error: !!result.error,
    });
    if (!result.error) setFilter('demo');
  };
  const list = useMemo(() => events.filter((e) => filter === 'all' || (filter === 'analysis' || filter === 'zone' ? e.kind === filter : e.source === filter)), [events, filter]);
  const counts = useMemo(() => ({
    high: events.filter((e) => e.level === 'high').length,
    moderate: events.filter((e) => e.level === 'moderate').length,
    live: events.filter((e) => e.source === 'live').length,
  }), [events]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vantyr-events-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <AppShell>
      <PageHeader eyebrow="Stored in this browser only" title={<>Event <span className="serif font-normal italic text-lens">history</span></>} sub="Saved human-check observations, approved snapshot reviews and configured zone flags. Older rule observations retain their original evidence and scores."
        right={<>
          <button onClick={exportJson} disabled={!events.length} data-testid="button-export" title="Export all saved events, regardless of the current filter" className="btn-ghost px-4 text-sm disabled:opacity-40"><Download className="h-4 w-4" />Export all JSON</button>
          <button onClick={() => { setClearError(false); setConfirm(true); }} disabled={!events.length} data-testid="button-clear" className="flex min-h-11 items-center gap-1.5 rounded-full border border-[hsl(352_60%_82%)] bg-[hsl(var(--paper))] px-4 text-sm text-[hsl(var(--hot))] transition-colors hover:bg-[hsl(352_80%_96%)] disabled:opacity-40"><Trash2 className="h-4 w-4" />Clear all</button>
        </>} />

      {unsaved.length > 0 && <div className="mb-6"><ZoneUnsaved events={unsaved} onRetry={retryZoneFlag} /></div>}
      <CheckUnsaved />
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[hsl(var(--rule))] bg-[hsl(var(--paper))] p-5">
        <div className="max-w-xl">
          <p className="text-sm font-semibold">Explore an example review workflow</p>
          <p className="mt-1 text-sm text-muted-foreground">Load four authored posture and zone examples with different review states. These are not real detections, never trigger responses, and stay in this browser only.</p>
        </div>
        <button type="button" onClick={loadExamples} data-testid="button-load-demo-events" className="btn-ghost min-h-11 px-4 text-sm">Load demo events</button>
        {demoNotice && <p role={demoNotice.error ? 'alert' : 'status'} className={cn('w-full text-sm', demoNotice.error ? 'text-[hsl(var(--hot))]' : 'text-muted-foreground')}>{demoNotice.text}</p>}
      </div>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:flex-wrap sm:items-end sm:gap-x-10">
        {[['High-level records', counts.high, 'text-[hsl(var(--hot))]'], ['Moderate-level records', counts.moderate, 'text-[hsl(var(--warn))]'], ['From camera', counts.live, 'text-lens'], ['Total', events.length, 'text-foreground']].map(([l, v, c], i) => (
          <motion.div key={l as string} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="sm:border-l sm:border-[hsl(var(--rule))] sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
            <div className={cn('font-display text-4xl font-semibold leading-none md:text-5xl tabular-nums', c as string)}>{v as number}</div>
            <div className="eyebrow mt-2 text-muted-foreground">{l as string}</div>
          </motion.div>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap gap-1 border-b border-[hsl(var(--rule))]" role="group" aria-label="Filter events">
        {(['all', 'live', 'demo', 'analysis', 'zone'] as F[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} data-testid={`button-filter-${f}`} aria-pressed={filter === f} className={cn('relative min-h-11 shrink-0 whitespace-nowrap px-3 text-sm capitalize transition-colors', filter === f ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {f === 'demo' ? 'Simulated' : f === 'analysis' ? 'AI reviews' : f === 'zone' ? 'Zones' : f === 'live' ? 'Camera' : 'All'}
            {filter === f && <motion.span layoutId="filter-rule" className="absolute inset-x-0 -bottom-px h-[2px] bg-[hsl(var(--lens))]" />}
          </button>
        ))}
      </div>

      {events.some((e) => e.kind === 'zone') && <div className="mb-8 border-b border-[hsl(var(--rule))] pb-6"><ZoneSessionSummary events={events} /></div>}

      {list.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-[hsl(var(--rule))] px-6 py-16 text-center" data-testid="status-empty">
          <StateIllustration kind={events.length ? 'filtered' : 'events'} />
          <p className="mt-4 font-display text-3xl font-semibold">{events.length ? 'Nothing in this filter' : 'Nothing logged'} <span className="serif font-normal italic">yet.</span></p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{filter === 'zone' ? 'Zone flags appear when a tracked person stays inside an applied restricted zone past its dwell time.' : 'History contains descriptive human-check episodes, approved snapshot reviews and configured zone flags. None is a verified harm report.'}</p>
          <Link href="/dashboard" className="btn-primary mt-6 px-5 py-2.5 text-sm" data-testid="link-go-monitor">Open monitor</Link>
        </div>
      ) : (
        <div className="divide-y divide-[hsl(var(--rule))] border-b border-[hsl(var(--rule))]">
          <AnimatePresence initial={false}>
            {list.map((e) => (
              <motion.div key={e.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} data-testid={`row-event-${e.id}`}>
                <div className="group relative flex items-start gap-2 px-1 py-3 transition-colors hover:bg-[hsl(var(--paper))] sm:px-3">
                  <button onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id} aria-controls={open === e.id ? `event-details-${e.id}` : undefined} className="flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-md py-1 text-left" data-testid={`button-expand-${e.id}`}>
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[hsl(var(--rule))] bg-[hsl(var(--paper))]">
                      {e.kind === 'analysis' ? <Sparkles className="h-4 w-4 text-[hsl(var(--warn))]" aria-hidden="true" /> : e.kind === 'zone' ? <Square className="h-4 w-4 text-lens" aria-hidden="true" /> : <ShieldAlert className="h-4 w-4 text-lens" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <time dateTime={new Date(e.ts).toISOString()} className="font-mono text-xs text-muted-foreground">{new Date(e.ts).toLocaleString()}</time>
                         {e.decision && <span className="text-xs font-medium text-lens">Human check suggested</span>}
                         {e.kind === 'zone' ? <span className="font-mono text-[11px] uppercase tracking-wider text-lens">Zone flag</span> : e.kind === 'analysis' ? <span className="text-xs font-medium text-[hsl(var(--warn))]">AI snapshot review</span> : null}
                      </span>
                      <span className="mt-1 block break-words text-[15px] leading-snug">{e.kind === 'zone' && e.zone ? `${e.zone.personLabel} in ${e.zone.zone.name}` : e.kind === 'risk' ? presentSavedObservation(e).observed[0] : e.summary ?? e.evidence[0] ?? 'No evidence recorded'}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-2">
                        {isExampleEvent(e) && <span className="rounded-full border border-[hsl(var(--rule))] px-2 py-0.5 text-[11px] font-medium">Demo example · not a real incident</span>}
                        {e.kind === 'risk' ? <span className="text-[11px] text-muted-foreground">{e.source === 'demo' ? 'Saved simulation' : 'Saved camera'}</span> : <SourceBadge source={e.source} />}
                        {e.kind !== 'analysis' && (e.review ? <ReviewBadge status={e.review.status} testId={`status-row-review-${e.id}`} /> : <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[11px] text-muted-foreground">Check not recorded</span>)}
                      </span>
                    </span>
                    <ChevronDown className={cn('mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open === e.id && 'rotate-180')} aria-hidden="true" />
                  </button>
                  <button onClick={() => deleteEvent(e.id)} aria-label="Delete event" data-testid={`button-delete-${e.id}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-[hsl(352_80%_96%)] hover:text-[hsl(var(--hot))]"><Trash2 className="h-4 w-4" /></button>
                </div>
                <AnimatePresence>
                  {open === e.id && (
                    <motion.div id={`event-details-${e.id}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="ml-4 space-y-3 border-l-2 border-[hsl(var(--lens))] pb-5 pl-4 text-sm sm:ml-14 sm:pl-6">
                                                {e.kind === 'risk' ? <ObservationAssessment presentation={presentSavedObservation(e)} compact /> : <>
                          {e.kind === 'analysis' && <div className="flex flex-wrap items-center gap-2"><LevelBadge level={e.level} /><span className="text-xs text-muted-foreground">Gemini opinion on one separately approved snapshot, not continuous on-device inference.</span></div>}
                          <div><p className="text-xs text-muted-foreground">Evidence</p><ul className="mt-1 list-disc pl-5">{e.evidence.length ? e.evidence.map((x, i) => <li key={i}>{x}</li>) : <li>None recorded</li>}</ul></div>
                        </>}
                        {e.kind === 'risk' && <p className="text-xs text-muted-foreground">{e.detections} detection(s) above threshold. {e.source === 'demo' ? 'Generated from scripted simulated input.' : 'Generated by on-device inference.'}</p>}
                        {e.recommendations && e.recommendations.length > 0 && <div><p className="text-xs text-muted-foreground">Recommendations</p><ul className="mt-1 list-disc pl-5">{e.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                        {e.limitations && <p className="text-xs text-muted-foreground">Limitations: {e.limitations}</p>}
                        {e.motion && <TrackingEvidence details={e.motion} recorded />}
                        {e.kind === 'zone' && e.zone && <>
                          <p className="text-xs text-muted-foreground">Zone "{e.zone.zone.name}": observed dwell {(e.zone.dwellMs / 1000).toFixed(1)} s against a {e.zone.zone.dwellSec} s threshold. Anonymous session {e.zone.sessionId.slice(0, 8)}, started {new Date(e.zone.sessionStartedAt).toLocaleString()}. Position is the box bottom-center in a 2D image; depth, occlusion and camera angle can place people in or out of the zone incorrectly. No images were stored.</p>
                        </>}
                        {e.kind !== 'analysis' && <EventReview key={e.id} event={e} />}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="rounded-2xl border-[hsl(var(--rule))] bg-[hsl(var(--paper))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Clear all {events.length} events?</AlertDialogTitle>
            <AlertDialogDescription>This removes the history from this browser. It cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          {clearError && <p role="alert" className="text-sm text-[hsl(var(--hot))]">History was not cleared. Browser storage is blocked or unavailable; allow storage, then retry.</p>}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { if (!clearEvents()) { e.preventDefault(); setClearError(true); } }} className="bg-[hsl(var(--hot))] text-white hover:bg-[hsl(352_72%_38%)]" data-testid="button-confirm-clear">Clear history</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
