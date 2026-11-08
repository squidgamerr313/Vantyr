import { retryCheck, usePendingChecks } from '@/lib/check-outbox';
export function CheckUnsaved() {
  const pending = usePendingChecks();
  if (!pending.length) return null;
  return <section className="my-3 space-y-2 border border-[hsl(var(--rule))] p-3 text-sm" data-testid="unsaved-checks" role="status">
    <p>{pending.length} human-check observation(s) not saved. Kept in memory only; leaving or reloading may lose them. Restore browser storage and retry. No human outcome has been recorded.</p>
    {pending.length >= 50 && <p>Human-check observation logging is paused until a pending record is saved.</p>}
    {pending.map((e) => <div key={e.id} className="flex flex-wrap items-center gap-2">
      <span className="text-xs">{e.decision?.triggers[0]?.label} · {e.source === 'demo' ? 'Simulation' : 'Camera'} · {new Date(e.ts).toLocaleString()}</span>
      <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => retryCheck(e.id)}>Retry saving observation</button>
    </div>)}
  </section>;
}
