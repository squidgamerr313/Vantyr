import type { MotionEvidence } from '@/lib/motion-evidence';

export function TrackingEvidence({ details, recorded = false }: { details: MotionEvidence; recorded?: boolean }) {
  return <section data-testid={recorded ? 'recorded-tracking' : 'person-tracking'} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="eyebrow text-muted-foreground">{recorded ? 'Recorded tracking evidence' : 'People & movement'}</h3>
      <span data-testid="status-tracking-quality" className="rounded-full border border-[hsl(var(--rule))] px-2 py-1 font-mono text-[10px]">
        {details.quality === 'limited' ? 'Limited / uncertain' : 'Observing · not verified safety'}
      </span>
    </div>
    {details.persons.length === 0 && <p className="text-xs text-muted-foreground">No usable person tracks. Posture and movement are uncertain.</p>}
    <ul className="divide-y divide-[hsl(var(--rule))]" data-testid="list-person-tracks">
      {details.persons.map((p, i) => <li key={p.id ?? `unknown-${i}`} className="space-y-1.5 py-3" data-testid={`track-${p.id ?? `unknown-${i}`}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">{p.label}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{p.status === 'missing-pose' ? 'Pose unavailable' : p.status === 'uncertain' ? 'Association uncertain' : p.status === 'new' ? 'New track' : 'Tracked'}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {p.posture === 'unavailable' ? 'Posture uncertain' : p.posture === 'horizontal' ? `Near-horizontal · ${(p.horizontalMs / 1000).toFixed(1)}s continuous` : `${p.posture === 'upright' ? 'Upright torso' : 'Tilted torso'} · ${(p.observedMs / 1000).toFixed(1)}s tracked`}
        </p>
        {p.observations.map((note, j) => <p key={j} className="text-xs leading-relaxed">{note}</p>)}
        {p.limitations.map((note, j) => <p key={j} className="text-xs leading-relaxed text-muted-foreground">{note}</p>)}
      </li>)}
    </ul>
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">Tracking limitations & timing</summary>
      <p className="mt-2">{details.timestampBasis === 'decoded-video' ? 'Durations use decoded video timestamps.' : details.timestampBasis === 'simulation' ? 'Scripted simulation timing; not real-camera evidence.' : 'Processing timestamps only; decoded video timing was unavailable.'} Rule scores are not event probabilities.</p>
      <ul className="mt-2 list-disc space-y-1 pl-4">{details.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </details>
  </section>;
}
