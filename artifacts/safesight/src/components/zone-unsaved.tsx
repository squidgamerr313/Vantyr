import { SourceBadge } from '@/components/shell';
import type { SafetyEvent } from '@/lib/store';

export function ZoneUnsaved({ events, sessionId, onRetry }: { events: SafetyEvent[]; sessionId?: string; onRetry: (episodeId: string) => void }) {
  if (!events.length) return null;
  return <section role="alert" className="space-y-3 border-l-2 border-[hsl(var(--hot))] pl-3 text-xs" data-testid="zone-outbox">
    <p className="font-medium">Zone flags not saved. They remain in this tab across navigation, but closing or reloading can lose them. Restore browser storage, then retry.</p>
    {events.map((e) => e.zone && <div key={e.zone.episodeId} className="flex flex-wrap items-center gap-2" data-testid={`zone-unsaved-${e.zone.episodeId}`}>
      <SourceBadge source={e.source} />
      <span className="min-w-0 flex-1">{e.zone.personLabel} in {e.zone.zone.name} · {new Date(e.ts).toLocaleString()} · session {e.zone.sessionId.slice(0, 8)}{sessionId && e.zone.sessionId !== sessionId ? ' (earlier session)' : ''}</span>
      <button type="button" onClick={() => onRetry(e.zone!.episodeId)} data-testid={`button-retry-${e.zone.episodeId}`} className="btn-ghost px-3 py-1.5">Retry save</button>
    </div>)}
  </section>;
}
