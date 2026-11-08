import { useEffect, useRef, useState } from 'react';
import { imagePoint, rectangle } from '@/lib/zone-monitor';
import type { ZoneConfig, ZoneRect } from '@/lib/zone-records';
import type { TrackedPerson } from '@/lib/person-tracking';

interface Props { zone: ZoneConfig | null; draftRect: ZoneRect | null; drawing: boolean; onDrawn: (rect: ZoneRect) => void; onCancel: () => void; width: number; height: number; persons: TrackedPerson[] }

export function ZoneOverlay({ zone, draftRect, drawing, onDrawn, onCancel, width, height, persons }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const start = useRef<[number, number] | null>(null);
  const [live, setLive] = useState<ZoneRect | null>(null);
  const cancelRef = useRef(onCancel); cancelRef.current = onCancel;
  useEffect(() => {
    if (!drawing) { start.current = null; setLive(null); return; }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { start.current = null; setLive(null); cancelRef.current(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [drawing]);
  if (!(width > 0 && height > 0)) return null;
  const point = (e: React.PointerEvent) => {
    const b = svg.current?.getBoundingClientRect();
    return b ? imagePoint(e.clientX, e.clientY, b, width, height) : null;
  };
  const R = (r: ZoneRect) => ({ x: r[0] * width, y: r[1] * height, width: r[2] * width, height: r[3] * height });
  const shown = live ?? draftRect;
  const sw = Math.max(width, height) / 400;
  const anchors = zone ? persons.filter((p) => p.id && p.detectionIndex !== null) : [];
  return (
    <svg ref={svg} data-testid="zone-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full" style={{ pointerEvents: drawing ? 'auto' : 'none', touchAction: drawing ? 'none' : 'auto', cursor: drawing ? 'crosshair' : 'default' }}
      aria-label={drawing ? 'Drag across the video to draw the zone. Press Escape to cancel.' : 'Restricted zone overlay'} role="img"
      onPointerDown={(e) => { if (!drawing) return; const p = point(e); if (!p) return; start.current = p; e.currentTarget.setPointerCapture(e.pointerId); setLive([p[0], p[1], 0, 0]); }}
      onPointerMove={(e) => { if (!drawing || !start.current) return; const b = svg.current?.getBoundingClientRect(); if (!b) return;
        const p = imagePoint(Math.min(Math.max(e.clientX, b.left), b.right), Math.min(Math.max(e.clientY, b.top), b.bottom), b, width, height); if (p) setLive(rectangle(start.current, p)); }}
      onPointerUp={(e) => { if (!drawing || !start.current) return; const p = point(e) ?? null; const r = p ? rectangle(start.current, p) : live; start.current = null; setLive(null); if (r && r[2] >= .02 && r[3] >= .02) onDrawn(r); }}
      onPointerCancel={() => { start.current = null; setLive(null); }}>
      {drawing && <rect x={0} y={0} width={width} height={height} fill="hsl(230 35% 11% / 0.18)" />}
      {zone && <g>
        <rect {...R(zone.rect)} fill="hsl(234 82% 52% / 0.10)" stroke="hsl(234 82% 62%)" strokeWidth={sw * 2} />
        <text x={zone.rect[0] * width + sw * 4} y={zone.rect[1] * height + sw * 14} fill="hsl(220 30% 99%)" stroke="hsl(230 35% 11% / 0.7)" strokeWidth={sw} paintOrder="stroke" fontSize={sw * 11} fontFamily="Geist Mono, monospace">{zone.name}</text>
      </g>}
      {shown && <rect {...R(shown)} fill="hsl(220 30% 99% / 0.12)" stroke="hsl(220 30% 99%)" strokeDasharray={`${sw * 5} ${sw * 4}`} strokeWidth={sw * 2} />}
      {anchors.map((p) => <g key={p.id}>
        <circle cx={(p.box[0] + p.box[2] / 2) * width} cy={(p.box[1] + p.box[3]) * height} r={sw * 4} fill="hsl(234 82% 62%)" stroke="hsl(220 30% 99%)" strokeWidth={sw} />
      </g>)}
    </svg>
  );
}
