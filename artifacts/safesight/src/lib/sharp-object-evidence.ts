import type { VisionResult } from './vision.ts';
import type { TrackingSummary } from './person-tracking.ts';
import { center, overlap, spatialCost, uniqueMatches, type Box } from './person-geometry.ts';

/** Research-only: this module is deliberately not imported by the live assessor. */
export const SHARP_OBJECT_POLICY = Object.freeze({
  version: 'sharp-object-v1', confidence: .55, minSidePx: 12, maxObjects: 20,
  maxGapMs: 160, persistenceMs: 500, minObservations: 5, personDistance: .3,
});
export const SHARP_OBJECT_ELIGIBILITY = Object.freeze({
  liveIntegration: false, strongerAlerts: false,
  result: 'research-only-no-go',
  reason: 'Object continuity is not possession or intent; detector and association qualification are required.',
});
export type ObjectVisibility = 'unknown' | 'clipped';
export interface SharpObjectObservation {
  id: string | null;
  detectionIndex: number;
  label: 'knife' | 'scissors';
  confidence: number;
  visibility: ObjectVisibility;
  tiny: boolean;
  association: { status: 'image-proximity' | 'uncertain' | 'none'; personId: string | null };
  matching: 'new' | 'continued' | 'ambiguous' | 'withheld';
  observations: number;
  observedMs: number;
  persistentObservation: boolean;
}
export interface SharpObjectEvidence {
  version: 'sharp-object-v1';
  eligibility: typeof SHARP_OBJECT_ELIGIBILITY;
  status: 'observed' | 'unavailable';
  observations: SharpObjectObservation[];
  limitations: string[];
}
type Track = { id: string; label: string; box: Box; since: number; count: number; personId: string | null };
const LIMITATIONS = [
  'A knife/scissors-shaped detection is an observation, not verified possession, ownership, weapon use, depth or intent.',
  'Visibility, blur and occlusion are unknown unless independently annotated; confidence is not visibility.',
  'Image proximity is not hand contact. Anonymous labels are session-local; any loss or ambiguity breaks continuity.',
  'Independent camera stability is unknown when scene motion evidence is absent.',
];

export function createSharpObjectEvidence() {
  let tracks: Track[] = [], nextId = 1;
  let lastTime: number | null = null, lastSource: string | null = null, lastSession: string | null = null, aspect: number | null = null;
  const invalidate = () => { tracks = []; lastTime = null; lastSource = null; lastSession = null; aspect = null; };
  const result = (observations: SharpObjectObservation[], status: SharpObjectEvidence['status'] = 'observed'): SharpObjectEvidence =>
    ({ version: 'sharp-object-v1', eligibility: SHARP_OBJECT_ELIGIBILITY, status, observations, limitations: [...LIMITATIONS] });
  return {
    reset: () => { invalidate(); nextId = 1; },
    stats: () => ({ tracks: tracks.length }),
    update(frame: VisionResult, tracking: TrackingSummary, width: number, height: number,
      context: { source: string; session: string }): SharpObjectEvidence {
      const time = frame.frameTimeMs;
      if (time === undefined || ![width, height, time].every(Number.isFinite) || width <= 0 || height <= 0 || !context.source || !context.session) {
        invalidate(); return result([], 'unavailable');
      }
      if (lastSource !== context.source || lastSession !== context.session || (aspect !== null && Math.abs(width / height - aspect) > .1) ||
          (lastTime !== null && (time <= lastTime || time - lastTime > SHARP_OBJECT_POLICY.maxGapMs))) tracks = [];
      lastSource = context.source; lastSession = context.session; aspect = width / height; lastTime = time;
      const cameraLimited = !!frame.sceneMotion && frame.sceneMotion.status !== 'stable';
      if (cameraLimited) tracks = [];
      const items = frame.detections.slice(0, SHARP_OBJECT_POLICY.maxObjects).flatMap((d, index) => {
        if ((d.label !== 'knife' && d.label !== 'scissors') || !Number.isFinite(d.confidence) ||
            d.confidence < 0 || d.confidence > 1 || !d.box.every(Number.isFinite) || d.box[2] <= 0 || d.box[3] <= 0) return [];
        const box: Box = [d.box[0] / width, d.box[1] / height, d.box[2] / width, d.box[3] / height];
        const clipped = box[0] <= 0 || box[1] <= 0 || box[0] + box[2] >= 1 || box[1] + box[3] >= 1;
        return [{ d, index, box, clipped, tiny: Math.min(d.box[2], d.box[3]) < SHARP_OBJECT_POLICY.minSidePx }];
      });
      const near = (a: Box, b: Box) => {
        const ac = center(a), bc = center(b);
        return Math.hypot(ac[0] - bc[0], ac[1] - bc[1]) < SHARP_OBJECT_POLICY.personDistance;
      };
      const associations = items.map(item => {
        const people = tracking.persons.filter(p => near(item.box, p.box));
        const person = people[0];
        if (!people.length) return { status: 'none', personId: null } as const;
        const overlapping = person && tracking.persons.some(p => p !== person && overlap(p.box, person.box) > .2);
        const otherTools = person && items.some(other => other !== item && near(other.box, person.box));
        if (people.length !== 1 || !person?.id || person.status === 'uncertain' || overlapping || otherTools || cameraLimited)
          return { status: 'uncertain', personId: null } as const;
        return { status: 'image-proximity', personId: person.id } as const;
      });
      const costs = items.map(item => tracks.map(t => item.d.label === t.label ? spatialCost(item.box, t.box) : Infinity));
      const matches = uniqueMatches(costs, tracks.length);
      const ambiguous = new Set(matches.ambiguousRows);
      items.forEach((item, i) => {
        if (costs[i]!.some((v, j) => Number.isFinite(v) && matches.ambiguousCols.has(j))) ambiguous.add(i);
        items.forEach((other, j) => { if (j !== i && overlap(item.box, other.box) > .1) ambiguous.add(i); });
      });
      const paired = new Map(matches.pairs);
      const next: Track[] = [];
      const observations = items.map((item, i): SharpObjectObservation => {
        const association = associations[i]!;
        const withheld = cameraLimited || item.clipped || item.tiny || item.d.confidence < SHARP_OBJECT_POLICY.confidence;
        const blocked = withheld || ambiguous.has(i) || association.status === 'uncertain';
        const previous = paired.has(i) ? tracks[paired.get(i)!] : undefined;
        // A changed/lost person cannot inherit the previous person's object clock.
        const freshPerson = association.personId !== null && tracking.persons.some(p => p.id === association.personId && p.status === 'new');
        const continued = !blocked && !freshPerson && previous && previous.personId === association.personId;
        const track: Track | null = blocked ? null : {
          id: continued ? previous.id : `o${nextId++}`, label: item.d.label, box: item.box,
          since: continued ? previous.since : time, count: continued ? Math.min(1_000_000, previous.count + 1) : 1,
          personId: association.personId,
        };
        if (track) next.push(track);
        const observedMs = track ? time - track.since : 0;
        return {
          id: track?.id ?? null, detectionIndex: item.index, label: item.d.label as 'knife' | 'scissors',
          confidence: item.d.confidence, visibility: item.clipped ? 'clipped' : 'unknown', tiny: item.tiny, association,
          matching: withheld ? 'withheld' : blocked ? 'ambiguous' : continued ? 'continued' : 'new',
          observations: track?.count ?? 0, observedMs,
          persistentObservation: !!track && observedMs >= SHARP_OBJECT_POLICY.persistenceMs && track.count >= SHARP_OBJECT_POLICY.minObservations,
        };
      });
      // A one-frame loss retires the object; no re-identification or hidden history.
      tracks = next;
      return result(observations);
    },
  };
}
