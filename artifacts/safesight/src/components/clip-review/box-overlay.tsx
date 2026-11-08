import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { ActorAnchor, Box } from '@/lib/clip-review';
import { cn } from '@/lib/utils';

export const ACTOR_TONE = { A: 'hsl(var(--lens))', B: 'hsl(var(--hot))' } as const;

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Native-aspect stage. Coordinates are normalized to the manifest frame. */
export function BoxOverlay({ width, height, children, visible, suggested, drawActor, enabled, onDraw }: {
  width: number; height: number; children: ReactNode; visible: ActorAnchor[]; suggested: Box | null;
  drawActor: 'A' | 'B'; enabled: boolean; onDraw: (box: Box) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const point = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const live: Box | null = drag ? [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)] : null;
  const style = (b: Box) => ({ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${(b[2] - b[0]) * 100}%`, height: `${(b[3] - b[1]) * 100}%` });
  return (
    <div ref={ref} data-testid="stage-review-video" className="relative w-full overflow-hidden rounded-xl bg-[hsl(var(--ink))]" style={{ aspectRatio: `${width} / ${height}` }}>
      {children}
      <div
        data-testid="overlay-draw-boxes"
        className={cn('absolute inset-0 touch-none', enabled ? 'cursor-crosshair' : 'pointer-events-none')}
        onPointerDown={(e) => { if (!enabled) return; e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
        onPointerMove={(e) => { if (!drag) return; const p = point(e); setDrag({ ...drag, x1: p.x, y1: p.y }); }}
        onPointerUp={() => {
          if (live && live[2] - live[0] > 0.01 && live[3] - live[1] > 0.01) onDraw(live.map(r4) as Box);
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        {suggested && (
          <div data-testid="box-suggested" className="absolute border border-dashed border-[hsl(var(--paper,48_30%_96%)/0.7)]" style={style(suggested)}>
            <span className="absolute -top-5 left-0 font-mono text-[10px] uppercase tracking-wider text-white/80">publisher hint</span>
          </div>
        )}
        {visible.map((a) => (
          <div key={a.actor} data-testid={`box-actor-${a.actor}`} className="absolute border-2" style={{ ...style(a.box), borderColor: ACTOR_TONE[a.actor], background: `color-mix(in srgb, ${ACTOR_TONE[a.actor]} 12%, transparent)` }}>
            <span className="absolute left-0 top-0 px-1.5 font-mono text-[11px] font-semibold text-white" style={{ background: ACTOR_TONE[a.actor] }}>{a.actor}</span>
          </div>
        ))}
        {live && <div className="absolute border-2 border-dashed" style={{ ...style(live), borderColor: ACTOR_TONE[drawActor] }} />}
      </div>
    </div>
  );
}
