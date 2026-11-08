import type { MonitoringHealth } from '@/lib/monitoring-health';

const LABELS: Record<MonitoringHealth['phase'], string> = {
  stopped: 'Monitoring stopped', simulation: 'Simulation / not live', requesting: 'Camera permission / startup',
  loading: 'Models loading', waiting: 'Waiting for evidence', fresh: 'Fresh monitoring',
  stale: 'Evidence stale / cannot assess', interrupted: 'Monitoring interrupted', error: 'Monitoring error',
};

export function MonitoringStatus({ health, restart }: { health: MonitoringHealth; restart: () => void }) {
  const recover = ['stale', 'interrupted', 'error'].includes(health.phase);
  return (
    <section className="mb-4 min-w-0 rounded-lg border border-[hsl(var(--rule))] bg-white p-3" aria-label="Monitoring health" data-testid="monitoring-health">
      <div role="status" aria-live="polite" aria-atomic="true">
        <p className="text-sm font-semibold" data-testid="text-health-phase">{LABELS[health.phase]}</p>
        <p className="mt-1 break-words text-xs text-muted-foreground">{health.reason}</p>
      </div>
      {recover && <button onClick={restart} className="btn-ghost mt-2 px-3 py-1.5 text-xs">Restart camera</button>}
    </section>
  );
}
