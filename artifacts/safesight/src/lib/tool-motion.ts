import type { Detection } from './vision.ts';
import { overlap, spatialCost, uniqueMatches, type Box } from './person-geometry.ts';

export type ObjectProfile = 'balanced' | 'detail';
export type ToolMotionState = 'warming' | 'other-object' | 'mixed-labels' | 'little-displacement' | 'displacement' | 'repeated-direction-change';
export interface ToolMotionObservation {
  id: string;
  label: string;
  labels: string[];
  state: ToolMotionState;
  observations: number;
  elapsedMs: number;
  displacement: number;
  directionChanges: number;
  points: { x: number; y: number }[];
}
export interface ToolMotionEvidence {
  status: 'waiting' | 'observed' | 'unavailable';
  items: ToolMotionObservation[];
  note: string;
}
export const TOOL_LABELS = ['scissors', 'knife', 'remote', 'toothbrush'] as const;
const interested = new Set<string>(TOOL_LABELS);
type Sample = { x: number; y: number; t: number; label: string };
type Track = { id: string; box: Box; samples: Sample[] };
const empty = (status: ToolMotionEvidence['status'], note: string): ToolMotionEvidence => ({ status, items: [], note });
export const TOOL_MOTION_NOTE = 'Rule-based image-plane motion, not a learned action classifier. Camera movement, ordinary cutting and gestures can look similar. No contact, ownership, harm or intent is inferred. These observations do not trigger automatic responses.';

/** Session-only numeric evidence. No frames, media, person association or alerts. */
export function createToolMotionReviewer() {
  let tracks: Track[] = [], sequence = 0, previousTime: number | null = null;
  let previousWall: number | null = null, session = '', aspect = 0;
  let cached: ToolMotionEvidence = empty('waiting', TOOL_MOTION_NOTE);
  const reset = () => { tracks = []; previousTime = previousWall = null; session = ''; aspect = 0; cached = empty('waiting', TOOL_MOTION_NOTE); };
  return {
    reset,
    update(detections: readonly Detection[], width: number, height: number, time: number, wall: number, key: string): ToolMotionEvidence {
      if (!key || ![width, height, time, wall].every(Number.isFinite) || width <= 0 || height <= 0) {
        reset(); return empty('unavailable', 'Decoded timestamps or image dimensions are unavailable; tool motion is withheld.');
      }
      if (key === session && time === previousTime && previousWall !== null && wall >= previousWall && wall - previousWall <= 900) return cached;
      const samplingGap = key === session && ((previousTime !== null && time - previousTime > 900) ||
        (previousWall !== null && wall - previousWall > 900));
      if (key !== session || (aspect && Math.abs(width / height - aspect) > .01) ||
        (previousTime !== null && (time <= previousTime || time - previousTime > 900)) ||
        (previousWall !== null && (wall < previousWall || wall - previousWall > 900))) tracks = [];
      previousTime = time; previousWall = wall; session = key; aspect = width / height;
      // Cross-class detections in the same region are one disputed observation,
      // never a vote that can turn a remote into scissors.
      const candidates = detections.filter(d => interested.has(d.label) && d.confidence >= .35 && Number.isFinite(d.confidence) &&
        d.box.every(Number.isFinite) && d.box[2] >= 8 && d.box[3] >= 8 && d.box[0] >= 0 && d.box[1] >= 0 &&
        d.box[0] + d.box[2] <= width + 1 && d.box[1] + d.box[3] <= height + 1)
        .sort((a, b) => b.confidence - a.confidence).slice(0, 12);
      const rows: { box: Box; labels: string[] }[] = [];
      for (const d of candidates) {
        const box = d.box.map((n, i) => n / (i % 2 === 0 ? width : height)) as Box;
        const same = rows.find(r => overlap(r.box, box) > .45);
        if (same) { if (!same.labels.includes(d.label)) same.labels.push(d.label); }
        else if (rows.length < 8) rows.push({ box, labels: [d.label] });
      }
      const costs = rows.map(r => tracks.map(t => spatialCost(r.box, t.box)));
      const matches = uniqueMatches(costs, tracks.length);
      const next: Track[] = [];
      const items: ToolMotionObservation[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const match = matches.pairs.find(p => p[0] === i);
        const prior = match ? tracks[match[1]] : undefined;
        const currentLabel = row.labels.join(' / ');
        const sample: Sample = { x: row.box[0] + row.box[2] / 2, y: row.box[1] + row.box[3] / 2, t: time, label: currentLabel };
        const history = [...(prior?.samples ?? []), sample].filter(s => time - s.t <= 3000).slice(-30);
        const track = { id: prior?.id ?? `object-${++sequence}`, box: row.box, samples: history };
        next.push(track);
        const labels = [...new Set(history.flatMap(s => s.label.split(' / ')))];
        const mixed = labels.length > 1;
        const elapsedMs = time - history[0]!.t;
        let displacement = 0, directionChanges = 0;
        let direction: { x: number; y: number } | null = null;
        let anchor = history[0]!;
        for (const point of history.slice(1)) {
          const dx = point.x - anchor.x, dy = point.y - anchor.y, length = Math.hypot(dx, dy);
          // A 4%-of-image deadband avoids counting detector jitter as a gesture.
          if (length < .04) continue;
          displacement += length;
          if (direction && (direction.x * dx + direction.y * dy) / length < -.5) directionChanges++;
          direction = { x: dx / length, y: dy / length }; anchor = point;
        }
        const stable = history.length >= 3 && elapsedMs >= 500 && !mixed && ['scissors', 'knife'].includes(currentLabel);
        const state: ToolMotionState = mixed ? 'mixed-labels' : !['scissors', 'knife'].includes(currentLabel) ? 'other-object' : !stable ? 'warming'
          : directionChanges >= 2 && displacement >= .24 ? 'repeated-direction-change'
          : displacement >= .08 ? 'displacement' : 'little-displacement';
        items.push({ id: track.id, label: currentLabel, labels, state, observations: history.length, elapsedMs,
          displacement, directionChanges, points: history.map(({ x, y }) => ({ x, y })) });
      }
      tracks = next;
      cached = { status: rows.length ? 'observed' : 'waiting', items, note: samplingGap
        ? `Sampling gap exceeded 900 ms; motion continuity was reset. A slower device may need Balanced mode or fewer competing tasks. ${TOOL_MOTION_NOTE}`
        : TOOL_MOTION_NOTE };
      return cached;
    },
  };
}
