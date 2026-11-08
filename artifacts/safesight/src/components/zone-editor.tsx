import { useEffect, useRef, useState } from 'react';
import { Square, Check, X, PenLine } from 'lucide-react';
import { validRect, validZone } from '@/lib/zone-monitor';
import type { ZoneConfig, ZoneRect } from '@/lib/zone-records';
import { cn } from '@/lib/utils';

interface Props {
  zone: ZoneConfig | null; draftRect: ZoneRect | null; drawing: boolean; disabled: boolean; reason: string | null;
  onApply: (input: Omit<ZoneConfig, 'id'>) => void; onRemove: () => void; onDraw: () => void; onCancelDraw: () => void;
}
type Form = { name: string; dwell: string; x: string; y: string; w: string; h: string };
const pct = (n: number) => String(Math.round(n * 1000) / 10);
const fromRect = (r: ZoneRect) => ({ x: pct(r[0]), y: pct(r[1]), w: pct(r[2]), h: pct(r[3]) });
const DEFAULT: Form = { name: 'Restricted zone', dwell: '4', x: '30', y: '30', w: '40', h: '40' };

export function ZoneEditor({ zone, draftRect, drawing, disabled, reason, onApply, onRemove, onDraw, onCancelDraw }: Props) {
  const [form, setForm] = useState<Form>(() => zone ? { name: zone.name, dwell: String(zone.dwellSec), ...fromRect(zone.rect) } : DEFAULT);
  const zoneKey = zone ? JSON.stringify(zone) : '';
  const lastZone = useRef(zoneKey);
  useEffect(() => {
    if (zoneKey === lastZone.current) return;
    lastZone.current = zoneKey;
    if (zone) setForm({ name: zone.name, dwell: String(zone.dwellSec), ...fromRect(zone.rect) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey]);
  const draftKey = draftRect ? draftRect.join(',') : '';
  useEffect(() => {
    if (draftRect) setForm((f) => ({ ...f, ...fromRect(draftRect) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const rect: ZoneRect = [Number(form.x) / 100, Number(form.y) / 100, Number(form.w) / 100, Number(form.h) / 100];
  const dwellSec = Number(form.dwell);
  const name = form.name.trim();
  const errors: string[] = [];
  if (!name) errors.push('Enter a zone name.');
  if (form.name.length > 60) errors.push('Name must be 60 characters or fewer.');
  if (!Number.isInteger(dwellSec) || dwellSec < 1 || dwellSec > 60) errors.push('Dwell must be a whole number from 1 to 60 seconds.');
  if ([form.x, form.y, form.w, form.h].some((v) => v.trim() === '') || !validRect(rect)) errors.push('Rectangle must stay inside the image, with width and height of at least 2%.');
  const valid = errors.length === 0 && validZone({ id: 'draft', name, dwellSec, rect });
  const unsaved = !zone || zone.name !== name || zone.dwellSec !== dwellSec || zone.rect.some((v, i) => Math.abs(v - rect[i]) > 5e-4);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const num = (k: keyof Form, label: string, id: string, max: number, min = 0) => (
    <label className="block min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="number" inputMode="decimal" min={min} max={max} step={k === 'dwell' ? 1 : 0.1} value={form[k]} onChange={set(k)} disabled={disabled}
        data-testid={id} className="mt-1 w-full rounded-lg border border-[hsl(var(--rule))] bg-white px-2.5 py-2 font-mono text-sm tabular-nums disabled:opacity-50" />
    </label>
  );

  return (
    <div className="space-y-4 text-sm" aria-label="Restricted zone settings">
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <span data-testid="status-zone-applied" className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ring-1',
          zone ? 'bg-[hsl(234_80%_97%)] text-[hsl(var(--lens-deep))] ring-[hsl(234_60%_84%)]' : 'bg-white text-muted-foreground ring-[hsl(var(--rule))]')}>
          {zone ? `Applied: ${zone.name}` : 'No zone applied'}
        </span>
        {unsaved && <span data-testid="status-zone-unsaved" className="font-mono text-[11px] uppercase tracking-wider text-[hsl(var(--warn))]">{zone ? 'Unapplied edits' : 'Draft only'}</span>}
        {drawing && <span className="font-mono text-[11px] uppercase tracking-wider text-lens">Drawing, monitoring paused</span>}
      </div>
      {reason && <p role="status" className="border-l-2 border-[hsl(var(--warn))] pl-3 text-xs text-muted-foreground">{reason}</p>}
      <label className="block">
        <span className="text-xs text-muted-foreground">Zone name</span>
        <input value={form.name} maxLength={60} onChange={set('name')} disabled={disabled} data-testid="zone-name"
          className="mt-1 w-full rounded-lg border border-[hsl(var(--rule))] bg-white px-2.5 py-2 disabled:opacity-50" />
      </label>
      {num('dwell', 'Dwell before flag (seconds, 1 to 60)', 'zone-dwell', 60, 1)}
      <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <legend className="mb-1 text-xs text-muted-foreground">Rectangle, percent of the video image</legend>
        {num('x', 'Left %', 'zone-x', 98)}{num('y', 'Top %', 'zone-y', 98)}{num('w', 'Width %', 'zone-width', 100, 2)}{num('h', 'Height %', 'zone-height', 100, 2)}
      </fieldset>
      <p className="text-xs text-muted-foreground">Edits here do not change the active zone until you press Apply zone. Drawing on the video fills these fields; monitoring pauses while you draw.</p>
      <p className="text-xs text-muted-foreground">Membership uses the bottom-center of a detected person's box in this 2D image—not measured feet, floor distance, authorization or machine activity.</p>
      <p className="text-xs text-muted-foreground">Keep the camera fixed. Switching camera or video shape removes the zone. If you physically move or zoom the camera, redraw the zone; not all camera movement can be detected.</p>
      {errors.length > 0 && <ul role="alert" className="list-disc pl-5 text-xs text-[hsl(var(--hot))]">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        {drawing
          ? <button type="button" onClick={onCancelDraw} data-testid="button-draw-zone" className="btn-ghost px-3.5 py-2"><X className="h-4 w-4" />Cancel drawing</button>
          : <button type="button" onClick={onDraw} disabled={disabled} data-testid="button-draw-zone" className="btn-ghost px-3.5 py-2 disabled:opacity-40"><PenLine className="h-4 w-4" />Draw zone</button>}
        <button type="button" onClick={() => onApply({ name, dwellSec, rect })} disabled={disabled || !valid || drawing || !unsaved} data-testid="button-apply-zone" className="btn-primary px-3.5 py-2 disabled:opacity-40"><Check className="h-4 w-4" />Apply zone</button>
        <button type="button" onClick={onRemove} disabled={!zone} data-testid="button-remove-zone" className="btn-ghost px-3.5 py-2 text-[hsl(var(--hot))] disabled:opacity-40"><Square className="h-4 w-4" />Remove</button>
      </div>
    </div>
  );
}
