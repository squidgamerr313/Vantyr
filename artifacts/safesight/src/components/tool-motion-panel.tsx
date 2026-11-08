import type { ObjectProfile, ToolMotionEvidence, ToolMotionObservation, ToolMotionState } from '@/lib/tool-motion';

const STATE_TEXT: Record<ToolMotionState, string> = {
  warming: 'Warming up: too few samples',
  'other-object': 'Different object label, not a confirmed tool',
  'mixed-labels': 'Mixed labels: uncertain, no trajectory reading',
  'little-displacement': 'Little image displacement',
  displacement: 'Image displacement observed',
  'repeated-direction-change': 'Repeated direction change in image',
};
const STATE_TONE: Record<ToolMotionState, string> = {
  warming: 'hsl(var(--muted-foreground))', 'other-object': 'hsl(var(--muted-foreground))', 'mixed-labels': 'hsl(var(--warn))',
  'little-displacement': 'hsl(var(--muted-foreground))', displacement: 'hsl(var(--lens-deep))', 'repeated-direction-change': 'hsl(var(--lens-deep))',
};
const PROFILES: Array<{ id: ObjectProfile; label: string; hint: string }> = [
  { id: 'balanced', label: 'Balanced', hint: 'Current lightweight object model.' },
  { id: 'detail', label: 'Detail', hint: 'EfficientDet-Lite2 at 448×448 plus up to 2 bounded close-up passes. Extra download and CPU work. No guaranteed accuracy gain.' },
];

function Trail({ item }: { item: ToolMotionObservation }) {
  const pts = item.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const tone = STATE_TONE[item.state];
  const mixed = item.state === 'mixed-labels';
  const last = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 100 75" className="h-[60px] w-[80px] shrink-0 rounded border border-[hsl(var(--rule))] bg-[hsl(40_30%_95%)]" role="img"
      aria-label={mixed ? 'Image positions withheld for mixed labels' : `Image-coordinate trail, ${pts.length} points`}>
      {!mixed && pts.length > 1 && (
        <polyline fill="none" stroke={tone} strokeWidth="1.5" strokeLinejoin="round" points={pts.map(p => `${p.x * 100},${p.y * 75}`).join(' ')} />
      )}
      {!mixed && last && <circle cx={last.x * 100} cy={last.y * 75} r="2.5" fill={tone} />}
      {mixed && <text x="50" y="42" textAnchor="middle" fontSize="10" fill="hsl(var(--warn))">uncertain</text>}
    </svg>
  );
}

export function ToolMotionPanel({ profile, onProfileChange, disabled, evidence, fresh, source }: {
  profile: ObjectProfile; onProfileChange: (profile: ObjectProfile) => void; disabled: boolean;
  evidence: ToolMotionEvidence | null; fresh: boolean; source: 'live' | 'demo' | 'off';
}) {
  const showLive = source === 'live' && fresh && !!evidence;
  const status = source === 'demo' ? 'Demo running: simulation is not real camera evidence; tool motion withheld.'
    : source === 'off' ? 'Camera stopped: no live tool-motion evidence.'
    : !fresh ? 'Live evidence is stale; withheld until fresh frames arrive.'
    : !evidence ? 'Waiting for the first analysed frame.'
    : evidence.status === 'unavailable' ? evidence.note
    : evidence.items.length ? `${evidence.items.length} scissors/knife/remote/toothbrush observation${evidence.items.length === 1 ? '' : 's'} in the last 3 s.`
    : 'No scissors, knife, remote or toothbrush detected in recent frames.';
  const tone = showLive && evidence?.items.length ? 'hsl(var(--lens))' : source === 'demo' ? 'hsl(var(--sim))' : 'hsl(var(--muted-foreground))';

  return (
    <article className="my-4 rounded-xl border border-[hsl(var(--rule))] bg-[hsl(var(--paper))] p-4" aria-labelledby="tool-motion-title" data-testid="tool-motion-panel">
      <p className="eyebrow text-muted-foreground">Experimental / review only</p>
      <h2 id="tool-motion-title" className="mt-1 text-lg font-bold">Object motion observations</h2>

      <fieldset className="mt-3" disabled={disabled}>
        <legend className="text-xs font-semibold">Object detection profile{disabled ? ' (stop the camera to change)' : ''}</legend>
        <div role="radiogroup" className="mt-2 flex flex-col gap-2 sm:flex-row">
          {PROFILES.map(p => {
            const on = profile === p.id;
            return (
              <label key={p.id} className="ssd-toggle !items-start flex-1 py-2 text-sm" data-on={on} style={{ opacity: disabled ? .6 : 1 }}>
                <input type="radio" name="tool-profile" className="sr-only" checked={on} disabled={disabled}
                  onChange={() => onProfileChange(p.id)} aria-describedby={`tool-profile-hint-${p.id}`} data-testid={`tool-profile-${p.id}`} />
                <span className="ssd-toggle-box mt-[3px] shrink-0" aria-hidden="true">{on ? '\u2713' : ''}</span>
                <span>
                  <span className="font-medium">{p.label}</span>
                  <span id={`tool-profile-hint-${p.id}`} className="block text-xs text-muted-foreground">{p.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div role="status" aria-live="polite" aria-atomic="true" className="mt-3 border-l-[3px] bg-[hsl(40_30%_95%)] px-3 py-2" style={{ borderColor: tone }} data-testid="tool-motion-status" data-source={source} data-fresh={fresh}>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-[2px]" style={{ background: tone }} />
          {source === 'demo' ? 'Simulation, not live' : showLive ? 'Live, session only' : 'Withheld'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{status}</p>
      </div>

      {showLive && evidence!.note.startsWith('Sampling gap') && <p className="mt-2 text-xs text-muted-foreground" data-testid="tool-motion-gap">{evidence!.note}</p>}
      {showLive && evidence!.items.length > 0 && (
        <ul className="mt-3 divide-y divide-[hsl(var(--rule))] rounded-lg border border-[hsl(var(--rule))]">
          {evidence!.items.map(item => {
            const mixed = item.state === 'mixed-labels';
            return (
              <li key={item.id} className="flex gap-3 px-3 py-2 text-xs" data-testid="tool-motion-item" data-state={item.state}>
                <Trail item={item} />
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-semibold">Detector label: {item.label}</p>
                  <p className="mt-0.5 font-medium" style={{ color: STATE_TONE[item.state] }}>{STATE_TEXT[item.state]}</p>
                  <p className="mt-0.5 text-muted-foreground">Labels seen: {item.labels.join(', ')}</p>
                  <p className="font-mono text-muted-foreground">
                    {item.observations} samples over {(item.elapsedMs / 1000).toFixed(1)} s
                    {!mixed && ` · path ${(item.displacement * 100).toFixed(1)}% of frame · ${item.directionChanges} reversals`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Rule-based image motion, not learned action recognition. Camera movement, ordinary cutting and gestures can look the same. No stabbing, contact, ownership or intent recognition. No automatic responses. Labels are shown exactly as detected; remotes and toothbrushes are never treated as tools. Not calibrated and not a danger probability.
      </p>
    </article>
  );
}
