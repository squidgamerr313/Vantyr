import { Play, Square, Trash2, Camera, RefreshCw, GraduationCap, ScanSearch, CheckCheck, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { CalibrationController } from '@/lib/calibration-types';
import { CALIBRATION_LABELS, type CalibrationLabel } from '@/lib/calibration';

const PHASE_TEXT: Record<CalibrationController['phase'], string> = {
  off: 'Stopped', preparing: 'Preparing camera', collecting: 'Collecting labelled samples', training: 'Training on this device', stopping: 'Stopping',
};
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

export function CalibrationPanel({ controller: c, disabled }: { controller: CalibrationController; disabled: boolean }) {
  const active = c.phase !== 'off';
  const [videoSize, setVideoSize] = useState({ width: 640, height: 480 });
  const collecting = c.phase === 'collecting';
  const canStart = c.consent && !disabled && c.phase === 'off';
  const canTrain = collecting && !c.capturing && !c.requirement;
  const tone = c.phase === 'training' ? 'hsl(var(--warn))' : active ? 'hsl(var(--lens))' : 'hsl(var(--muted-foreground))';
  const ev = c.evaluation;

  return (
    <article className="my-4 rounded-xl border border-[hsl(var(--rule))] bg-[hsl(var(--paper))] p-4" aria-labelledby="calibration-title" data-testid="calibration-panel">
      <details open={active || undefined}>
        <summary className="cursor-pointer list-none">
          <p className="eyebrow text-muted-foreground">Optional lab / browser only / off by default</p>
          <h2 id="calibration-title" className="mt-1 text-lg font-bold">Object-class calibration</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Adjusts a small classifier over a public baseline using your own labelled camera captures. No LLM. Expand to open.
            {c.applied && <span className="ml-1 font-semibold" style={{ color: 'hsl(var(--lens-deep))' }}>Calibration applied in this tab.</span>}
          </p>
        </summary>

        <div role="status" aria-live="polite" aria-atomic="true" className="mt-3 border-l-[3px] bg-[hsl(40_30%_95%)] px-3 py-2" style={{ borderColor: tone }} data-testid="calibration-status" data-phase={c.phase} data-applied={c.applied}>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-[2px]" style={{ background: tone }} />
            {PHASE_TEXT[c.phase]}{c.applied ? ' · applied weights active' : ''}{c.draft && !c.applied ? ' · draft ready' : ''}
          </p>
          {c.message && <p className="mt-1 break-words text-xs text-muted-foreground">{c.message}</p>}
          {disabled && <p className="mt-1 text-xs font-medium" style={{ color: 'hsl(var(--warn))' }}>Main monitor or simulation is active. Stop it to start calibration. Stop and Clear stay available.</p>}
        </div>

        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Use closed scissors and ordinary safe items only. Do not reenact risky actions.</li>
          <li>This calibrates object class labels only. It does not train actions or intent and does not improve localization.</li>
          <li>Class scores are not danger probabilities.</li>
        </ul>

        <label className="mt-3 flex min-h-[44px] items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={c.consent} onChange={e => c.setConsent(e.target.checked)} disabled={active} data-testid="calibration-consent" />
          <span>
            <span className="font-medium">I choose to try optional calibration.</span>
            <span className="block text-xs text-muted-foreground">Training is optional. Images are not saved or uploaded. Transient numeric embeddings stay in this tab's memory and are still sensitive; Stop clears them.</span>
          </span>
        </label>

        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="ssd-btn ssd-btn-ink" onClick={() => void c.start()} disabled={!canStart} data-testid="calibration-start"><Play size={14} aria-hidden="true" /> Start calibration camera</button>
          <button type="button" className="ssd-btn ssd-btn-stop" onClick={() => void c.stop()} data-testid="calibration-stop"><Square size={14} aria-hidden="true" /> Stop</button>
          <button type="button" className="ssd-btn" onClick={() => void c.clear()} data-testid="calibration-clear"><Trash2 size={14} aria-hidden="true" /> Clear session</button>
        </div>
        <p className="ssd-fine">Stop clears private features, draft and camera streams. Applied weights stay in memory until Forget, leaving this monitor page or reload.</p>

        <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <figure className="relative overflow-hidden rounded-lg border border-[hsl(var(--rule))] bg-[hsl(40_30%_95%)]">
            <video ref={c.videoRef} muted playsInline className="block w-full" style={{ aspectRatio: `${videoSize.width}/${videoSize.height}` }}
              onLoadedMetadata={event => { const v = event.currentTarget; if (v.videoWidth && v.videoHeight) setVideoSize({ width: v.videoWidth, height: v.videoHeight }); }}
              aria-label="Raw calibration video, not safety monitoring" data-testid="calibration-video" />
            <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 border-2 border-dashed"
              style={{ borderColor: 'hsl(var(--lens))', width: `${65 * Math.min(videoSize.width, videoSize.height) / videoSize.width}%` }} />
            <figcaption className="absolute left-2 top-2 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider" style={{ background: 'var(--ssd-sim-wash)', color: 'hsl(var(--sim))' }}>Not safety monitoring</figcaption>
            {!active && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted-foreground">Camera off. Nothing is requested until you press Start.</p>}
            <p className="absolute bottom-1 left-2 right-2 text-[10px] text-muted-foreground">Encoder uses the centre square only. Keep the object inside it.</p>
          </figure>

          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold" htmlFor="calibration-label">Label for next capture</label>
            <select id="calibration-label" className="-mt-2 min-h-[44px] rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--paper))] px-3 font-mono text-sm"
              value={c.label} onChange={e => c.setLabel(e.target.value as CalibrationLabel)} disabled={!collecting} data-testid="calibration-label">
              {CALIBRATION_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <fieldset disabled={!collecting}>
              <legend className="text-xs font-semibold">Split</legend>
              <div role="radiogroup" className="mt-1 flex gap-2" data-testid="calibration-split">
                {(['train', 'validation'] as const).map(s => (
                  <label key={s} className="ssd-toggle flex-1 text-sm" data-on={c.split === s}>
                    <input type="radio" name="calibration-split" className="sr-only" checked={c.split === s} onChange={() => c.setSplit(s)} data-testid={`calibration-split-${s}`} />
                    <span className="ssd-toggle-box" aria-hidden="true">{c.split === s ? '\u2713' : ''}</span>{s === 'train' ? 'Training' : 'Validation'}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ssd-btn" onClick={c.newView} disabled={!collecting || c.capturing} data-testid="calibration-new-view"><RefreshCw size={14} aria-hidden="true" /> New view</button>
              <button type="button" className="ssd-btn ssd-btn-ink" onClick={() => void c.capture()} disabled={!collecting || c.capturing} data-testid="calibration-capture"><Camera size={14} aria-hidden="true" /> {c.capturing ? 'Capturing' : 'Capture labelled sample'}</button>
            </div>
            <p className="text-xs text-muted-foreground">New view: change orientation or background between groups. Validation must use a distinct view from training. Views so far: <span className="font-mono">{c.groups}</span>.</p>
          </div>
        </div>

        <section className="mt-4" aria-labelledby="calibration-counts-title">
          <h3 id="calibration-counts-title" className="text-sm font-semibold">Samples per class</h3>
          <table className="mt-2 w-full text-xs" data-testid="calibration-counts">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Class</th><th className="font-medium">Train</th><th className="font-medium">Validation</th></tr></thead>
            <tbody className="font-mono">
              {CALIBRATION_LABELS.map(l => {
                const n = c.counts[l] ?? { train: 0, validation: 0 };
                return <tr key={l} className="border-t border-[hsl(var(--rule))]" data-testid={`calibration-count-${l}`}><td className="py-1">{l}</td><td>{n.train}</td><td>{n.validation}</td></tr>;
              })}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted-foreground">Public baseline examples: <span className="font-mono">{c.publicCount}</span>. {c.requirement ?? 'Requirements met for training.'}</p>
        </section>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="ssd-btn ssd-btn-ink" onClick={c.train} disabled={!canTrain} data-testid="calibration-train"><GraduationCap size={14} aria-hidden="true" /> Train draft</button>
          {(c.phase === 'training' || c.draft !== null) && (
            <div className="flex min-w-[160px] flex-1 items-center gap-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress * 100)}>
              <div className="h-2 flex-1 overflow-hidden rounded bg-[hsl(40_30%_92%)]"><div className="h-full origin-left" style={{ background: 'hsl(var(--lens))', transform: `scaleX(${Math.min(1, Math.max(0, c.progress))})` }} /></div>
              <span className="font-mono text-xs">{Math.round(c.progress * 100)}%</span>
            </div>
          )}
        </div>

        <section className="mt-4" aria-labelledby="calibration-eval-title" data-testid="calibration-evaluation">
          <h3 id="calibration-eval-title" className="text-sm font-semibold">Held-out evaluation</h3>
          {c.baselineEvaluation && <p className="mt-2 text-xs text-muted-foreground">
            Public baseline on the same snapshots: {c.baselineEvaluation.correct}/{c.baselineEvaluation.count} correct;
            {' '}{c.baselineEvaluation.accepted}/{c.baselineEvaluation.count} accepted;
            {' '}{c.baselineEvaluation.falseToolCalls} high-score false tool calls.
            Trained head: {ev?.falseToolCalls ?? 0} high-score false tool calls.
            Apply rejects validation regressions and insufficient accuracy/coverage. These small-sample checks are not safety certification.
          </p>}
          {!ev ? <p className="mt-2 rounded-lg border border-dashed border-[hsl(var(--rule))] p-3 text-xs text-muted-foreground">No draft evaluated yet.</p> : (
            <>
              <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Accuracy</dt><dd>{ev.correct}/{ev.count} ({pct(ev.correct, ev.count)})</dd></div>
                <div><dt className="text-muted-foreground">Coverage</dt><dd>{ev.accepted}/{ev.count} ({pct(ev.accepted, ev.count)})</dd></div>
                <div><dt className="text-muted-foreground">Accepted correct</dt><dd>{ev.acceptedCorrect}/{ev.accepted} ({pct(ev.acceptedCorrect, ev.accepted)})</dd></div>
                <div><dt className="text-muted-foreground">Denominator</dt><dd>{ev.count} snapshots</dd></div>
              </dl>
              <div className="mt-2 overflow-x-auto">
                <table className="text-[11px] font-mono">
                  <caption className="text-left text-muted-foreground">Rows actual, columns predicted</caption>
                  <thead><tr><th />{ev.labels.map(l => <th key={l} className="px-1 font-medium">{l.slice(0, 6)}</th>)}</tr></thead>
                  <tbody>{ev.matrix.map((row, i) => (
                    <tr key={i}><th className="pr-2 text-left font-medium">{ev.labels[i]}</th>
                      {row.map((n, j) => <td key={j} className="px-1 text-center" style={{ background: n ? (i === j ? 'var(--ssd-lens-wash)' : 'var(--ssd-sim-wash)') : undefined }}>{n}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Same-camera held-out snapshots. Validation is reused across drafts and is not an independent field test.</p>
            </>
          )}
        </section>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="ssd-btn" onClick={() => void c.test()} disabled={!collecting || c.capturing} data-testid="calibration-test"><ScanSearch size={14} aria-hidden="true" /> Test current crop</button>
          <button type="button" className="ssd-btn ssd-btn-ink" onClick={() => void c.apply()} disabled={!c.draft} data-testid="calibration-apply"><CheckCheck size={14} aria-hidden="true" /> Apply review suggestions</button>
          <button type="button" className="ssd-btn" onClick={c.forget} disabled={!c.applied} data-testid="calibration-forget"><Undo2 size={14} aria-hidden="true" /> Forget applied model</button>
        </div>
        {c.prediction && (
          <p className="mt-2 font-mono text-xs" data-testid="calibration-prediction">
            Crop: <b>{c.prediction.label}</b>{c.prediction.uncertain ? ` (top candidate ${c.prediction.candidate})` : ''} · class score {c.prediction.classScore.toFixed(3)} · margin {c.prediction.margin.toFixed(3)}
          </p>
        )}
        <p className="ssd-fine">Applying only adds review suggestions. It does not override the detector or trigger any action. Class scores are not danger probabilities.</p>
      </details>
    </article>
  );
}
