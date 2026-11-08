import { useMemo, useState } from 'react';
import type { SafetyEvent } from '@/lib/store';
import { summarizeZoneSessions } from '@/lib/zone-records';
import { SourceBadge } from '@/components/shell';

const dur = (ms: number | null) => ms === null ? 'none yet' : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : ms < 3600000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 3600000).toFixed(1)} h`;

export function ZoneSessionSummary({ events, sessionId }: { events: SafetyEvent[]; sessionId?: string }) {
  const all = useMemo(() => summarizeZoneSessions(events), [events]);
  const list = sessionId ? all.filter((s) => s.id === sessionId) : all;
  const [pick, setPick] = useState(0);
  const idx = Math.min(pick, Math.max(0, list.length - 1));
  const s = list[idx];
  return (
    <section data-testid="zone-session-summary" className="text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="eyebrow text-foreground">Zone session summary</h2>
        {!sessionId && list.length > 1 && (
          <label className="ml-auto flex max-w-full min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">Session
            <select value={idx} onChange={(e) => setPick(Number(e.target.value))} data-testid="select-zone-session" className="max-w-full min-w-0 rounded-lg border border-[hsl(var(--rule))] bg-white px-2 py-1.5 text-foreground">
              {list.map((x, i) => <option key={`${x.source}:${x.id}`} value={i}>{new Date(x.startedAt).toLocaleString()} · {x.source === 'live' ? 'Live camera' : 'Simulated'} · {x.total}</option>)}
            </select>
          </label>
        )}
      </div>
      {!s ? <p className="mt-2 text-xs text-muted-foreground">No saved zone records{sessionId ? ' in this session' : ''} yet.</p> : (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><SourceBadge source={s.source} /><span>Started {new Date(s.startedAt).toLocaleString()}</span><span className="font-mono">Session {s.id.slice(0, 8)}</span></div>
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            {([['Flags', s.total], ['Awaiting', s.open], ['Check not recorded', s.notRecorded], ['Reviewed', s.reviewed], ['Resolved', s.resolved], ['Dismissed', s.dismissed]] as const).map(([l, v]) => (
              <div key={l}><dt className="eyebrow text-muted-foreground">{l}</dt><dd className="font-display text-2xl font-semibold tabular-nums" data-testid={`text-summary-${l.toLowerCase()}`}>{v}</dd></div>
            ))}
            <div><dt className="eyebrow text-muted-foreground">Mean time to first review</dt><dd className="font-display text-2xl font-semibold tabular-nums">{dur(s.meanFirstReviewMs)}</dd></div>
          </dl>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Counts cover zone records still saved in this browser, grouped by source and anonymous session. These are workflow statuses, not assistance outcomes, injury counts or model-accuracy measures. They are not lifetime totals and do not show that an area was safe. Risk and AI review records are not included.</p>
    </section>
  );
}
