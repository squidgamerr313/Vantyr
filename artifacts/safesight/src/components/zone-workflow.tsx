import type { SafetyEvent } from '@/lib/store';
import type { ZoneConfig } from '@/lib/zone-records';
import type { ZoneProgress } from '@/lib/zone-monitor';
import { SourceBadge } from '@/components/shell';
import { ZoneReview, ReviewBadge, fmtSec } from '@/components/zone-review';
import { cn } from '@/lib/utils';
import { ZoneUnsaved } from '@/components/zone-unsaved';

interface Props { zone: ZoneConfig | null; progress: ZoneProgress; events: SafetyEvent[]; unsaved: SafetyEvent[]; onRetry: (episodeId: string) => void; sessionId: string }
const STATUS = {
  off: ['Not monitoring', 'Apply a zone to start watching.', 'text-muted-foreground'],
  watching: ['Watching', 'Tracked people are timed while their box bottom-center is inside the zone.', 'text-[hsl(var(--safe))]'],
  uncertain: ['Uncertain', 'Someone is near the edge or tracking is unclear. Dwell timers restart rather than guess.', 'text-[hsl(var(--warn))]'],
  stale: ['Video stalled', 'No new frames arrived. Timers were cleared; nothing is being watched.', 'text-[hsl(var(--hot))]'],
} as const;

export function ZoneWorkflow({ zone, progress, events, unsaved, onRetry, sessionId }: Props) {
  const [label, desc, color] = STATUS[progress.status];
  const latest = events[0];
  return (
    <div data-testid="zone-workflow" className="space-y-5 break-words text-sm [overflow-wrap:anywhere]">
      <div aria-live="polite">
        <p className={cn('font-mono text-[11px] uppercase tracking-wider', color)} data-testid="status-zone-monitor">{label}{zone && progress.status !== 'off' ? ` · ${zone.name}` : ''}</p>
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        {zone && progress.occupants.length > 0 && (
          <ul className="mt-3 space-y-2">
            {progress.occupants.map((o) => {
              const ratio = Math.min(1, o.dwellMs / (zone.dwellSec * 1000));
              return <li key={o.id} data-testid={`zone-occupant-${o.id}`}>
                <div className="flex justify-between gap-2 text-xs"><span>{o.label}{o.state === 'boundary' ? ' (at edge, not timed)' : ''}</span><span className="font-mono tabular-nums">{fmtSec(o.dwellMs)} / {zone.dwellSec} s{o.flagged ? ' · flagged' : ''}</span></div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-[hsl(var(--rule))]"><div className={cn('h-full origin-left', o.flagged ? 'bg-[hsl(var(--warn))]' : 'bg-[hsl(var(--lens))]')} style={{ transform: `scaleX(${ratio})` }} /></div>
              </li>;
            })}
          </ul>
        )}
      </div>
      {latest?.zone && (
        <div className="border-l-2 border-[hsl(var(--warn))] pl-4">
          <div className="flex flex-wrap items-center gap-2"><p className="font-display text-lg font-semibold">Zone flag: {latest.zone.zone.name}</p><SourceBadge source={latest.source} /></div>
          <p className="mt-1 text-xs text-muted-foreground">A tracked person stayed past the dwell threshold. This is an observation for a person to check, not a severity rating or a safety verdict.</p>
        </div>
      )}
      <ZoneUnsaved events={unsaved} sessionId={sessionId} onRetry={onRetry} />
      {events.length > 0 ? (
        <ul className="divide-y divide-[hsl(var(--rule))] border-y border-[hsl(var(--rule))]">
          {events.map((e) => (
            <li key={e.id}>
              <details className="group py-3" open={e === latest && (e.review?.status === 'open' || e.review?.status === 'reviewed')}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="min-w-0 flex-1 truncate">{e.zone?.personLabel} in {e.zone?.zone.name}</span>
                  <SourceBadge source={e.source} />
                  {e.review ? <ReviewBadge status={e.review.status} /> : <span className="text-xs text-muted-foreground">Check not recorded</span>}
                </summary>
                <div className="mt-3"><ZoneReview event={e} /></div>
              </details>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">No saved zone flags in this session.</p>}
    </div>
  );
}
