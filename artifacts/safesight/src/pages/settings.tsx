import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, Check, AlertTriangle, BookOpen } from 'lucide-react';
import { Link } from 'wouter';
import { AppShell, PageHeader } from '@/components/shell';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { usePrefs, setPrefs as writePrefs, resetPrefs, type Preferences, type RiskLevel } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { armAudio } from '@/lib/audio';

function Row({ label, value, hint, children }: { label: string; value?: string; hint: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 border-b border-[hsl(var(--rule))] py-5 last:border-b-0 sm:grid-cols-[1fr_1fr] sm:items-center sm:gap-10">
      <div>
        <p className="flex items-baseline gap-3 text-[15px] font-medium">{label}{value && <span className="font-mono text-sm text-lens tabular-nums">{value}</span>}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, id }: { value: T; options: [T, string][]; onChange: (v: T) => void; id: string }) {
  return (
    <div className="inline-flex flex-wrap rounded-full border border-[hsl(var(--rule))] bg-[hsl(var(--paper))] p-1" role="group">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} data-testid={`button-${id}-${v}`} aria-pressed={value === v} className={cn('min-h-11 rounded-full px-4 text-sm transition-colors', value === v ? 'bg-[hsl(var(--ink))] text-[hsl(var(--paper))]' : 'text-muted-foreground hover:text-foreground')}>{l}</button>
      ))}
    </div>
  );
}

function OnOff({ on }: { on: boolean }) {
  return <span className={cn('w-7 font-mono text-xs uppercase', on ? 'text-lens' : 'text-muted-foreground')} aria-hidden="true">{on ? 'On' : 'Off'}</span>;
}

type SaveState = { ok: boolean; label: string } | null;

function Group({ n, title, children, desc }: { n: string; title: string; children: ReactNode; desc?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Number(n) * 0.07, duration: 0.45 }}
      className="grid grid-cols-1 gap-2 border-t border-[hsl(var(--ink))] pt-5 md:grid-cols-[220px_1fr] md:gap-10">
      <div className="md:sticky md:top-24 md:self-start">
        <span className="font-mono text-xs text-lens">0{n}</span>
        <h2 className="mt-1 font-display text-2xl font-semibold">{title}</h2>
        {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      </div>
      <div>{children}</div>
    </motion.section>
  );
}

export default function Settings() {
  const p = usePrefs();
  const { toast } = useToast();
  const [saved, setSaved] = useState<SaveState>(null);
  /** Writes through the store and reports the real outcome; never claims success on a failed write. */
  const setPrefs = (patch: Partial<Preferences>, label = 'Preference') => {
    const ok = writePrefs(patch);
    setSaved({ ok, label });
    return ok;
  };
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <PageHeader eyebrow="Saved locally, applied instantly" title={<>Detection <span className="serif font-normal italic text-lens">preferences</span></>} sub="Tune what the monitor shows, how often it looks, and what gets logged."
          right={<><Link href="/docs" data-testid="link-settings-docs" className="btn-ghost px-4 text-sm"><BookOpen className="h-4 w-4" aria-hidden="true" />Help and docs</Link><button onClick={() => { const ok = resetPrefs(); setSaved({ ok, label: 'All preferences reset' }); if (ok) toast({ title: 'Preferences reset to defaults' }); }} data-testid="button-reset-prefs" className="btn-ghost px-4 text-sm"><RotateCcw className="h-4 w-4" />Reset</button></>} />
        <p role="status" aria-live="polite" data-testid="status-prefs-save" className={cn('mb-8 flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm', !saved ? 'border-[hsl(var(--rule))] text-muted-foreground' : saved.ok ? 'border-[hsl(var(--rule))] text-foreground' : 'border-[hsl(352_60%_82%)] bg-[hsl(352_80%_97%)] text-[hsl(var(--hot))]')}>
          {!saved ? 'Changes save to this browser as you make them.' : saved.ok ? <><Check className="h-4 w-4 text-[hsl(var(--safe))]" aria-hidden="true" />{saved.label} saved in this browser.</> : <><AlertTriangle className="h-4 w-4" aria-hidden="true" />{saved.label} was not saved. Browser storage is blocked or the value was rejected; the previous setting still applies.</>}
        </p>
        <div className="space-y-14">
          <Group n="1" title="Camera and inference" desc="What the monitor looks at and how often.">
            <Row label="Camera facing" hint="Front is the selfie camera on phones. Applied the next time the camera starts.">
              <Seg id="facing" value={p.facingMode} options={[['user', 'Front'], ['environment', 'Rear']]} onChange={(v) => setPrefs({ facingMode: v }, 'Camera facing')} />
            </Row>
            <Row label="Minimum confidence" value={`${(p.minConfidence * 100).toFixed(0)}%`} hint="Detections below this are hidden and excluded from scoring. Object risk rules also require at least 55% confidence.">
              <Slider value={[p.minConfidence * 100]} min={20} max={95} step={1} onValueChange={([v]) => setPrefs({ minConfidence: v / 100 }, 'Minimum confidence')} data-testid="slider-confidence" aria-label="Minimum confidence" />
            </Row>
            <Row label="Frame interval" value={`${p.intervalMs} ms`} hint="Lower means more frames per second and more battery use.">
              <Slider value={[p.intervalMs]} min={40} max={1000} step={10} onValueChange={([v]) => setPrefs({ intervalMs: v }, 'Frame interval')} data-testid="slider-interval" aria-label="Frame interval" />
            </Row>
          </Group>
          <Group n="2" title="What you see and hear" desc="Display only. Turning overlays off does not change scoring.">
            <Row label="Bounding boxes" hint="Draw detection boxes with confidence labels."><span className="inline-flex min-h-11 items-center gap-3"><OnOff on={p.showBoxes} /><Switch checked={p.showBoxes} onCheckedChange={(v) => setPrefs({ showBoxes: v }, 'Bounding boxes')} data-testid="switch-boxes" aria-label="Bounding boxes" /></span></Row>
            <Row label="Pose skeleton" hint="Draw body landmarks used for posture evidence."><span className="inline-flex min-h-11 items-center gap-3"><OnOff on={p.showPose} /><Switch checked={p.showPose} onCheckedChange={(v) => setPrefs({ showPose: v }, 'Pose skeleton')} data-testid="switch-pose" aria-label="Pose skeleton" /></span></Row>
            <Row label="Human-check audio cue" hint="One playback tone for a new saved-check episode or zone flag, not a harm alarm or microphone monitoring. Optional speech review is separate in Monitor and requires new consent each session. Off by default."><span className="inline-flex min-h-11 items-center gap-3"><OnOff on={p.audioAlerts} /><Switch checked={p.audioAlerts} onCheckedChange={(v) => {
              if (setPrefs({ audioAlerts: v }, 'Audio cue') && v) void armAudio().then((error) => { if (error) toast({ title: 'Audio unavailable', description: error, variant: 'destructive' }); });
            }} data-testid="switch-audio" aria-label="Human-check audio cue" /></span></Row>
          </Group>
          <Group n="3" title="What gets recorded" desc="Stored in this browser only.">
            <Row label="Human-check history" hint="Low and moderate save descriptive check episodes. High-only withholds them because no high-priority action model is qualified. Zone flags and approved snapshots are separate.">
              <Seg id="threshold" value={p.logThreshold} options={[['low', 'Low'], ['moderate', 'Moderate'], ['high', 'High only']]} onChange={(v: RiskLevel) => setPrefs({ logThreshold: v }, 'Log level')} />
            </Row>
            <Row label="Duplicate prevention" hint="Each observed person episode is saved once. Repeated frames, a lower score or an unresolved human review do not create recurring logs. The legacy cooldown preference is retained but no longer drives check logging.">
              <span className="text-xs text-muted-foreground">Per-person episodes</span>
            </Row>
            <Row label="Keep at most" value={`${p.maxEvents} events`} hint="Applied when the next event is saved; oldest events beyond this limit are removed.">
              <Slider value={[p.maxEvents]} min={50} max={1000} step={50} onValueChange={([v]) => setPrefs({ maxEvents: v }, 'Event limit')} data-testid="slider-max-events" aria-label="Maximum events kept" />
            </Row>
          </Group>
          <p className="border-l-2 border-[hsl(var(--warn))] bg-[hsl(var(--surface))] px-4 py-3 text-sm text-[hsl(30_40%_25%)]">VANTYR is a proof of concept. It cannot reliably detect smoke or fire and cannot certify any environment as safe.</p>
        </div>
      </div>
    </AppShell>
  );
}
