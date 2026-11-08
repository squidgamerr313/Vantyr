import type { VisionResult } from '@/lib/vision';
import type { TrackedPerson } from './person-tracking';

const POSE_EDGES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [0, 11], [0, 12],
];

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  r: VisionResult,
  w: number,
  h: number,
  opts: { boxes: boolean; pose: boolean; minConf: number; simulated?: boolean; persons?: TrackedPerson[] },
) {
  ctx.clearRect(0, 0, w, h);
  const scale = Math.max(1, w / 900);
  const color = opts.simulated ? 'hsl(262 55% 44%)' : 'hsl(190 95% 60%)';
  if (opts.boxes) {
    for (const [index, d] of r.detections.entries()) {
      if (d.confidence < opts.minConf) continue;
      const [x, y, bw, bh] = d.box;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * scale;
      ctx.setLineDash(opts.simulated ? [8 * scale, 5 * scale] : []);
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, 6 * scale);
      ctx.stroke();
      ctx.setLineDash([]);
      const track = opts.persons?.find((p) => p.detectionIndex === index);
      const label = opts.simulated ? `SIM ${track?.label ?? d.label} / scripted`
        : `${track?.label ?? d.label} ${(d.confidence * 100).toFixed(1)}%`;
      ctx.font = `600 ${12 * scale}px 'JetBrains Mono', monospace`;
      const tw = ctx.measureText(label).width + 12 * scale;
      const th = 20 * scale;
      const ty = y - th - 4 * scale < 0 ? y + 4 * scale : y - th - 4 * scale;
      ctx.fillStyle = opts.simulated ? 'hsl(42 40% 99%)' : 'hsla(228, 50%, 6%, 0.82)';
      ctx.beginPath();
      ctx.roundRect(x, ty, tw, th, 5 * scale);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(label, x + 6 * scale, ty + 14 * scale);
    }
  }
  if (opts.pose) {
    for (const pts of r.landmarks) {
      ctx.strokeStyle = opts.simulated ? 'hsl(234 82% 52%)' : 'hsla(174, 80%, 55%, 0.9)';
      ctx.lineWidth = 2.5 * scale;
      for (const [a, b] of POSE_EDGES) {
        const p = pts[a], q = pts[b];
        if (!p || !q) continue;
        if ((p.visibility ?? 1) < 0.4 || (q.visibility ?? 1) < 0.4) continue;
        ctx.beginPath();
        ctx.moveTo(p.x * w, p.y * h);
        ctx.lineTo(q.x * w, q.y * h);
        ctx.stroke();
      }
      ctx.fillStyle = 'hsl(214 40% 96%)';
      for (const p of pts) {
        if ((p.visibility ?? 1) < 0.4) continue;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 3 * scale, 0, Math.PI * 2);
        ctx.fill();
        if (opts.simulated) ctx.stroke();
      }
    }
    for (const person of opts.persons ?? []) {
      if (person.poseIndex === null || (opts.boxes && person.detectionIndex !== null)) continue;
      ctx.fillStyle = color; ctx.font = `600 ${12 * scale}px monospace`;
      ctx.fillText(`${opts.simulated ? 'SIM ' : ''}${person.label}`, person.box[0] * w, Math.max(15 * scale, person.box[1] * h));
    }
  }
}

/** Simulated input for the demo scene. Coordinates in a 1536x864 frame (16:9). */
export const DEMO_W = 1536;
export const DEMO_H = 864;

function person(cx: number, top: number, hgt: number, lean: number, armUp: number) {
  const pts = Array.from({ length: 33 }, () => ({ x: cx, y: top, visibility: 0.2 }));
  const set = (i: number, x: number, y: number) => (pts[i] = { x: x / DEMO_W, y: y / DEMO_H, visibility: 0.95 });
  const u = hgt / 8;
  const sx = cx + lean * u;
  set(0, sx, top + u * 0.6);
  set(11, sx - u * 0.9, top + u * 1.6); set(12, sx + u * 0.9, top + u * 1.6);
  set(13, sx - u * 1.3, top + u * (2.8 - armUp * 2)); set(14, sx + u * 1.3, top + u * 2.9);
  set(15, sx - u * 1.4, top + u * (3.9 - armUp * 4)); set(16, sx + u * 1.5, top + u * 4);
  set(23, cx - u * 0.6, top + u * 4.3); set(24, cx + u * 0.6, top + u * 4.3);
  set(25, cx - u * 0.7, top + u * 6); set(26, cx + u * 0.7, top + u * 6);
  set(27, cx - u * 0.7, top + u * 7.7); set(28, cx + u * 0.75, top + u * 7.7);
  set(31, cx - u * 0.9, top + u * 8); set(32, cx + u * 1, top + u * 8);
  return pts;
}

export function simulateFrame(t: number): VisionResult {
  const s = t / 1000;
  const lean = Math.sin(s * 0.7) * 1.4 + (Math.sin(s * 0.23) > 0.6 ? 1.6 : 0);
  const p1x = 470 + Math.sin(s * 0.5) * 18, p1top = 210, p1h = 430;
  const p2x = 1040 + Math.sin(s * 0.3) * 60, p2top = 330, p2h = 400;
  const jitter = (k: number) => Math.min(0.99, Math.max(0.3, k + Math.sin(s * 2.1 + k * 10) * 0.05));
  return {
    detections: [
      { id: 's1', label: 'person', confidence: jitter(0.88), box: [p1x - 85 + lean * 20, p1top - 10, 190, p1h + 20] },
      { id: 's2', label: 'person', confidence: jitter(0.81), box: [p2x - 80, p2top - 10, 170, p2h + 20] },
      { id: 's3', label: 'ladder', confidence: jitter(0.57), box: [380, 380, 180, 440] },
    ],
    landmarks: [person(p1x, p1top, p1h, lean, (Math.sin(s * 1.1) + 1) / 2), person(p2x, p2top, p2h, Math.sin(s * 0.4) * 0.3, 0.1)],
    latency: 0,
    frameTimeMs: t,
  };
}
