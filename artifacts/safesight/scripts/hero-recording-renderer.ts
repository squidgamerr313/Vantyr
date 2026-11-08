import type { VisionResult } from '../src/lib/vision';
import { drawOverlay } from '../src/lib/overlay';

/*
 * Behind-the-scenes composition for the landing hero recording (1600x900).
 * Every pixel and value is derived from the supplied inputs:
 *  - source: the continuously playing licensed footage (current frame)
 *  - analysis: the frozen frame the engine actually analysed (matches result)
 *  - result: the actual VisionResult for that analysis frame
 * Overlay graphics are only ever drawn on the matched analysis frame.
 */

const W = 1600, H = 900;
const BG = 'hsl(30 8% 9%)';
const PAPER = 'hsl(36 22% 88%)';
const DIM = 'hsl(34 10% 58%)';
const FAINT = 'hsl(34 8% 30%)';
const OCHRE = 'hsl(36 62% 62%)';
const MONO = "'JetBrains Mono', 'Geist Mono', ui-monospace, monospace";

type Rect = { x: number; y: number; w: number; h: number };

function fit(sw: number, sh: number, r: Rect): Rect {
  const s = Math.min(r.w / sw, r.h / sh);
  const w = sw * s, h = sh * s;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

function ticks(ctx: CanvasRenderingContext2D, r: Rect, c: string) {
  const k = 14;
  ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(r.x, r.y + k); ctx.lineTo(r.x, r.y); ctx.lineTo(r.x + k, r.y);
  ctx.moveTo(r.x + r.w - k, r.y); ctx.lineTo(r.x + r.w, r.y); ctx.lineTo(r.x + r.w, r.y + k);
  ctx.moveTo(r.x, r.y + r.h - k); ctx.lineTo(r.x, r.y + r.h); ctx.lineTo(r.x + k, r.y + r.h);
  ctx.moveTo(r.x + r.w - k, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h - k);
  ctx.stroke();
}

function caption(ctx: CanvasRenderingContext2D, x: number, y: number, a: string, b?: string) {
  ctx.font = `600 13px ${MONO}`; ctx.fillStyle = OCHRE; ctx.textBaseline = 'alphabetic';
  ctx.fillText(a, x, y);
  if (b) { const w = ctx.measureText(a).width; ctx.font = `400 13px ${MONO}`; ctx.fillStyle = DIM; ctx.fillText(b, x + w + 12, y); }
}

const fmt = (n: number | undefined, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—');

export function createHeroRecordingRenderer(canvas: HTMLCanvasElement) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const overlay = document.createElement('canvas');
  let overlayFor: VisionResult | null = null;
  let resultCount = 0;
  let lastFrameTime: number | undefined;

  function prepareOverlay(r: VisionResult, fw: number, fh: number) {
    if (overlayFor === r && overlay.width === fw && overlay.height === fh) return;
    overlay.width = fw; overlay.height = fh;
    const o = overlay.getContext('2d');
    if (o) drawOverlay(o, r, fw, fh, { boxes: true, pose: true, minConf: 0.5 });
    overlayFor = r;
  }

  function draw(source: HTMLVideoElement, analysis: HTMLCanvasElement | null, result: VisionResult | null, elapsedMs: number) {
    const c = ctx!;
    if (result && result.frameTimeMs !== lastFrameTime) { lastFrameTime = result.frameTimeMs; resultCount++; }
    c.fillStyle = BG; c.fillRect(0, 0, W, H);

    // faint measuring rule along the top
    c.strokeStyle = FAINT; c.lineWidth = 1;
    for (let x = 48; x <= W - 48; x += 16) {
      c.beginPath(); c.moveTo(x, 34); c.lineTo(x, x % 128 === 48 ? 46 : 40); c.stroke();
    }

    // Left: source footage as it plays (no overlay ever drawn here)
    const srcBox: Rect = { x: 48, y: 96, w: 560, h: 315 };
    const decoded = source.readyState >= 2 && source.videoWidth > 0;
    const sR = decoded ? fit(source.videoWidth, source.videoHeight, srcBox) : srcBox;
    c.fillStyle = 'hsl(30 6% 5%)'; c.fillRect(srcBox.x, srcBox.y, srcBox.w, srcBox.h);
    if (decoded) c.drawImage(source, sR.x, sR.y, sR.w, sR.h);
    ticks(c, srcBox, FAINT);
    caption(c, 48, 82, 'INPUT', `video t=${fmt(source.currentTime, 2)}s`);

    // Right: matched analysis frame with production overlay
    const anaBox: Rect = { x: 648, y: 96, w: 904, h: 508 };
    c.fillStyle = 'hsl(30 6% 5%)'; c.fillRect(anaBox.x, anaBox.y, anaBox.w, anaBox.h);
    let aR: Rect | null = null;
    if (analysis && result && analysis.width > 0) {
      aR = fit(analysis.width, analysis.height, anaBox);
      c.drawImage(analysis, aR.x, aR.y, aR.w, aR.h);
      prepareOverlay(result, analysis.width, analysis.height);
      c.drawImage(overlay, aR.x, aR.y, aR.w, aR.h);
    } else {
      c.font = `400 15px ${MONO}`; c.fillStyle = DIM; c.textAlign = 'center';
      c.fillText(decoded ? 'waiting for first engine result' : 'waiting for video to decode', anaBox.x + anaBox.w / 2, anaBox.y + anaBox.h / 2);
      c.textAlign = 'left';
    }
    ticks(c, anaBox, OCHRE);
    caption(c, 648, 82, 'ANALYSED FRAME', result ? `frameTimeMs ${fmt(result.frameTimeMs, 0)} · production overlay` : 'no result yet');

    // Bottom-right: actual person crops from the analysed frame
    const persons = result && analysis ? result.detections.filter((d) => d.label === 'person' && d.confidence >= 0.5).slice(0, 4) : [];
    const cropY = 648, cropH = 212;
    caption(c, 648, cropY - 14, 'PERSON CROPS', result ? `${persons.length} from detections` : '');
    let cx = 648;
    for (const d of persons) {
      const [bx, by, bw, bh] = d.box;
      const sx = Math.max(0, bx), sy = Math.max(0, by);
      const sw = Math.min(analysis!.width - sx, bw), sh = Math.min(analysis!.height - sy, bh);
      if (sw < 2 || sh < 2) continue;
      const cw = Math.min(220, (cropH * sw) / sh);
      const r = fit(sw, sh, { x: cx, y: cropY, w: cw, h: cropH });
      c.drawImage(analysis!, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
      // landmarks within this crop, from the actual result
      if (result) for (const pts of result.landmarks) for (const p of pts) {
        if ((p.visibility ?? 1) < 0.4) continue;
        const px = p.x * analysis!.width, py = p.y * analysis!.height;
        if (px < sx || py < sy || px > sx + sw || py > sy + sh) continue;
        c.fillStyle = PAPER; c.beginPath();
        c.arc(r.x + ((px - sx) / sw) * r.w, r.y + ((py - sy) / sh) * r.h, 2.2, 0, Math.PI * 2); c.fill();
      }
      ticks(c, r, FAINT);
      c.font = `400 11px ${MONO}`; c.fillStyle = DIM;
      c.fillText(`${d.id} ${(d.confidence * 100).toFixed(1)}%`, r.x, r.y + r.h + 16);
      cx += r.w + 20;
      if (cx > 1500) break;
    }
    if (result && persons.length === 0) {
      c.font = `400 13px ${MONO}`; c.fillStyle = DIM; c.fillText('no person detection at or above 50% in this frame', 648, cropY + 24);
    }

    // Bottom-left: raw output excerpt
    const lines: [string, string][] = [];
    if (!result) {
      lines.push(['result', 'null']);
    } else {
      lines.push(['frameTimeMs', fmt(result.frameTimeMs, 1)]);
      lines.push(['frame', `${result.frameWidth ?? '—'} x ${result.frameHeight ?? '—'}`]);
      lines.push(['latency', `${fmt(result.latency)} ms`]);
      if (result.stages) {
        lines.push(['  objectMs', fmt(result.stages.objectMs)]);
        lines.push(['  poseMs', fmt(result.stages.poseMs)]);
        lines.push(['  skippedPose', String(result.stages.skippedPose)]);
      }
      lines.push(['detections', String(result.detections.length)]);
      for (const d of result.detections.slice(0, 4)) {
        lines.push([`  ${d.label}`, `${d.confidence.toFixed(3)} [${d.box.map((v) => Math.round(v)).join(', ')}]`]);
      }
      const vis = result.landmarks.map((p) => p.filter((q) => (q.visibility ?? 1) >= 0.4).length);
      lines.push(['landmarks', `${result.landmarks.length} set(s)${vis.length ? ` · visible ${vis.join('/')}` : ''}`]);
    }
    caption(c, 48, 458, 'RAW RESULT', `results received ${resultCount}`);
    c.strokeStyle = FAINT; c.beginPath(); c.moveTo(48, 470); c.lineTo(608, 470); c.stroke();
    lines.slice(0, 15).forEach(([k, v], i) => {
      const y = 498 + i * 24;
      c.font = `400 14px ${MONO}`; c.fillStyle = DIM; c.fillText(k, 48, y);
      c.fillStyle = PAPER; c.fillText(v, 230, y);
    });

    // footer strip: wall-clock recording time
    c.font = `400 12px ${MONO}`; c.fillStyle = FAINT;
    c.fillText(`recording ${fmt(elapsedMs / 1000, 1)}s · licensed stock footage · on-device engine`, 48, 880);
  }

  return { draw };
}
