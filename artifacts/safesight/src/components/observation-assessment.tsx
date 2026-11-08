import { useId } from 'react';
import type { ObservationPresentation } from '@/lib/observation-presentation';
import { cn } from '@/lib/utils';

const LEVEL_TEXT: Record<string, string> = {
  low: 'text-[hsl(var(--safe))]',
  moderate: 'text-[hsl(var(--warn))]',
  high: 'text-[hsl(var(--hot))]',
  uncertain: 'text-muted-foreground',
};

function Group({ id, title, marker, items, testId }: { id: string; title: string; marker: string; items: string[]; testId: string }) {
  return (
    <section aria-labelledby={id} className="min-w-0 border-t border-[hsl(var(--rule))] pt-3" data-testid={testId}>
      <h3 id={id} className="eyebrow flex items-center gap-2 text-foreground">
        <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', marker)} />
        {title}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="break-words pl-3.5 text-[14px] leading-snug text-foreground [overflow-wrap:anywhere] relative before:absolute before:left-0 before:top-[0.6em] before:h-px before:w-2 before:bg-[hsl(var(--rule))]">
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ObservationAssessment({ presentation: p, compact = false, technicalCollapsed = false }: { presentation: ObservationPresentation; compact?: boolean; technicalCollapsed?: boolean }) {
  const base = useId();
  const TechnicalContainer = technicalCollapsed ? 'details' : 'section';
  const ids = { title: `${base}-title`, obs: `${base}-obs`, unk: `${base}-unk`, chk: `${base}-chk`, tech: `${base}-tech` };
  const sourceTone = p.recorded ? 'text-muted-foreground ring-[hsl(var(--rule))] bg-[hsl(225_25%_96%)]'
    : p.source === 'demo' ? 'text-[hsl(var(--sim))] ring-[hsl(262_40%_84%)] bg-[hsl(262_60%_97%)]'
    : p.source === 'live' ? 'text-[hsl(var(--lens-deep))] ring-[hsl(234_60%_84%)] bg-[hsl(234_80%_97%)]'
    : 'text-muted-foreground ring-[hsl(var(--rule))] bg-[hsl(225_25%_96%)]';

  return (
    <article aria-labelledby={ids.title} className="min-w-0 break-words" data-testid="observation-assessment">
      <header className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span data-testid="text-observation-source" className={cn('inline-flex max-w-full items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ring-1', sourceTone)}>
            {p.sourceLabel}
          </span>
          {p.recorded && <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Saved, not live now</span>}
        </div>
        <h2 id={ids.title} data-testid="text-observation-headline" className={cn('mt-2 font-display font-semibold leading-tight text-foreground', compact ? 'text-lg' : 'text-xl md:text-2xl')}>
          {p.headline}
        </h2>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground" data-testid="text-observation-hint">{p.sourceHint}</p>
      </header>
      {p.decision && <section className="mt-3 text-xs text-muted-foreground" data-testid="context-decision">
        <p>Review priority: <strong>{p.decision.priority === 'check' ? 'Human check suggested' : p.decision.priority === 'context' ? 'Context only' : 'No check triggered'}</strong> · {p.recorded ? 'Evidence at observation' : 'Evidence'}: {p.decision.freshness} · Person evidence: {p.decision.quality}</p>
        <p className="mt-1">Priority is a workflow suggestion, not severity or a probability of harm.</p>
        {p.recorded && p.decision.triggers[0] && <p className="mt-1" data-testid="check-subject">Check subject: <strong>{p.decision.triggers[0].label}</strong> ({p.decision.triggers[0].personId}). This review applies only to this person episode.</p>}
        {p.decision.zone && <p className="mt-1">Configured image zone: {p.decision.zone.name} · {p.decision.zone.dwellSec}s dwell · {p.decision.zone.status}. Zone flags stay in their separate review workflow.</p>}
      </section>}

      <div className={cn('mt-4 grid gap-4', !compact && 'md:gap-5')}>
        <Group id={ids.obs} title="Observed" marker="bg-[hsl(var(--lens))]" items={p.observed} testId="section-observed" />
        <Group id={ids.unk} title="Not known" marker="bg-[hsl(var(--warn))]" items={p.unknown} testId="section-unknown" />
        <Group id={ids.chk} title="What to check" marker="bg-[hsl(var(--ink))]" items={p.checks} testId="section-checks" />
      </div>

      <TechnicalContainer aria-labelledby={ids.tech} className="mt-4 border-t border-[hsl(var(--rule))] pt-3" data-testid="observation-technical">
        {technicalCollapsed ? (
          <summary id={ids.tech} className="min-h-11 cursor-pointer rounded-md py-3 text-sm font-medium text-[hsl(var(--lens-deep))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--lens))]">Technical details</summary>
        ) : (
          <h3 id={ids.tech} className="eyebrow text-muted-foreground">Technical context</h3>
        )}
        {p.technical ? (
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[12px] text-muted-foreground">
            <span>Rule score <span data-testid="text-risk-score" className="text-foreground">{p.technical.score}</span>/100</span>
            <span>Level <span data-testid="status-risk-level" className={cn('uppercase', LEVEL_TEXT[p.technical.level] ?? LEVEL_TEXT.uncertain)}>{p.technical.level}</span></span>
          </p>
        ) : (
          <p className="mt-1.5 font-mono text-[12px] text-muted-foreground" data-testid="text-no-score">{p.recorded ? 'No numeric rule score was recorded.' : 'No current rule score is available.'}</p>
        )}
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground" data-testid="text-observation-timing">{p.timing}</p>
        {p.recorded && p.decision?.triggers[0] && <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">Subject episode: {p.decision.triggers[0].episodeId}</p>}
        {p.technical && <p className="mt-1 text-[12px] leading-snug text-muted-foreground">The score is a configured heuristic, not a probability of harm.</p>}

        <details className="group mt-3" data-testid="list-evidence">
          <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md py-1 text-[13px] font-medium text-[hsl(var(--lens-deep))] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--lens))] [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">&#8250;</span>
            Original evidence ({p.originalEvidence.length})
          </summary>
          {p.recorded && <p className="mt-2 text-[12px] leading-snug text-muted-foreground">Original text is retained unchanged. Its wording is not a verified outcome.</p>}
          {p.originalEvidence.length ? (
            <ol className="mt-2 space-y-1.5 border-l border-[hsl(var(--rule))] pl-3">
              {p.originalEvidence.map((e, i) => (
                <li key={i} data-testid={`text-evidence-${i}`} className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{e}</li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">No original evidence text was recorded.</p>
          )}
        </details>
      </TechnicalContainer>
    </article>
  );
}
