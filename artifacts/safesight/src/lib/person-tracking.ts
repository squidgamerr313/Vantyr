import type { VisionResult } from './vision.ts';
import { center, observePeople, overlap, spatialCost, uniqueMatches, MAX_PEOPLE, type Box, type Torso } from './person-geometry.ts';

export type TrackingStatus = 'new' | 'tracked' | 'missing-pose' | 'uncertain';
export interface TrackedPerson {
  id: string | null;
  label: string;
  box: Box;
  detectionIndex: number | null;
  poseIndex: number | null;
  status: TrackingStatus;
  posture: 'upright' | 'tilted' | 'horizontal' | 'unavailable';
  horizontalMs: number;
  observedMs: number;
  observations: string[];
  limitations: string[];
}
export interface TrackingSummary {
  quality: 'observing' | 'limited';
  persons: TrackedPerson[];
  limitations: string[];
}
type Sample = { time: number; torso: Torso };
type Track = { id: string; label: string; box: Box; seen: number; since: number; horizontalSince: number | null; samples: Sample[]; recent: { kind: string; note: string; at: number }[] };
export const TRACK_GAP_MS = 2500;
export const HISTORY_MS = 1200;
export const MAX_SAMPLES = 32;
export const TRACKING_LIMITATIONS = [
  'Track labels are anonymous and session-local, not personal identities or re-identification. Labels restart after loss or ambiguous crossings.',
  'Movement is measured in the image plane. Camera movement, occlusion and perspective can be misleading; use a fixed camera.',
  'Posture and motion observations do not confirm a push, fall, injury or intent.',
];
export function createPersonTracker() {
  const tracks = new Map<string, Track>();
  let nextId = 1;
  let lastTime: number | null = null;
  const invalidate = () => { tracks.clear(); lastTime = null; };
  const reset = () => { invalidate(); nextId = 1; };
  return {
    reset, invalidate,
    stats: () => ({ tracks: tracks.size, samples: [...tracks.values()].reduce((sum, t) => sum + t.samples.length, 0) }),
    update(frame: VisionResult, width: number, height: number, time: number): TrackingSummary {
      if (lastTime !== null && (time <= lastTime || time - lastTime > TRACK_GAP_MS)) tracks.clear();
      lastTime = time;
      for (const [id, track] of tracks) if (time - track.seen > TRACK_GAP_MS) tracks.delete(id);
      const observations = observePeople(frame, width, height);
      const previous = [...tracks.values()];
      const costs = observations.map((o) => previous.map((t) => spatialCost(o.box, t.box)));
      const matches = uniqueMatches(costs, previous.length);
      const crowded = new Set<number>();
      observations.forEach((o, i) => {
        observations.forEach((other, j) => { if (j > i && overlap(o.box, other.box) > .2) { crowded.add(i); crowded.add(j); } });
      });
      for (const i of matches.ambiguousRows) crowded.add(i);
      for (const [i, row] of costs.entries()) if (row.some((v, j) => Number.isFinite(v) && matches.ambiguousCols.has(j))) crowded.add(i);
      // Retire identities rather than guessing who emerged on the other side of a crossing.
      for (const i of crowded) costs[i]!.forEach((v, j) => { if (Number.isFinite(v)) tracks.delete(previous[j]!.id); });
      const paired = new Map(matches.pairs.filter(([i, j]) => !crowded.has(i) && tracks.has(previous[j]!.id)).map(([i, j]) => [i, previous[j]!]));
      const reserved = new Set([...paired.values()].map((t) => t.id));
      const translations = [...paired].map(([i, t]) => {
        const a = center(observations[i]!.box), b = center(t.box);
        return [a[0] - b[0], a[1] - b[1]];
      });
       const sharedMotion = !frame.sceneMotion && translations.length >= 2 && translations.every(([x, y]) =>
        Math.hypot(x!, y!) > .035 && Math.hypot(x! - translations[0]![0]!, y! - translations[0]![1]!) < .018);
       const sceneLimited = !!frame.sceneMotion && frame.sceneMotion.status !== 'stable';
      const updated = new Set<string>();
      const persons: TrackedPerson[] = observations.map((o, index) => {
         const limited = o.ambiguous || crowded.has(index) || sharedMotion || sceneLimited;
        const limitations: string[] = [];
        if (crowded.has(index)) limitations.push('People overlap or association is ambiguous. Identity and posture history were not carried across this frame.');
        if (o.ambiguous) limitations.push('A pose could not be uniquely associated with a detected person.');
        if (sharedMotion) limitations.push('Shared image motion may be camera movement or coordinated activity. Motion and posture histories were restarted.');
         if (sceneLimited) limitations.push(`${frame.sceneMotion!.reason} Motion and posture histories were restarted; unsupported camera compensation was not attempted.`);
        if (crowded.has(index)) return {
          id: null, label: 'Unassigned person', box: o.box, detectionIndex: o.detectionIndex, poseIndex: o.poseIndex,
          status: 'uncertain', posture: 'unavailable', horizontalMs: 0, observedMs: 0, observations: [], limitations,
        };
        let track = paired.get(index);
        const isNew = !track;
        if (!track) {
          const n = nextId++;
          track = { id: `p${n}`, label: `Person ${n}`, box: o.box, seen: time, since: time, horizontalSince: null, samples: [], recent: [] };
          // Current observations take precedence over stale tracks when the cap is reached.
          if (tracks.size >= MAX_PEOPLE) {
            const oldest = [...tracks.values()].filter((t) => !updated.has(t.id) && !reserved.has(t.id)).sort((a, b) => a.seen - b.seen)[0];
            if (oldest) tracks.delete(oldest.id);
          }
          tracks.set(track.id, track);
        }
        if (track.seen < time && !track.samples.length) track.horizontalSince = null;
        track.box = o.box; track.seen = time;
        updated.add(track.id);
        const notes: string[] = [];
        if (!o.torso || limited) {
          track.samples = []; track.horizontalSince = null; track.recent = [];
          if (!o.torso) limitations.push('Required shoulder/hip landmarks are missing or not sufficiently visible. Posture timing is paused and restarted.');
        } else {
          track.samples = track.samples.filter((s) => time - s.time <= HISTORY_MS);
          const earlier = track.samples.find((s) => time - s.time >= 250);
          if (earlier) {
            const dt = time - earlier.time;
            const record = (kind: string, note: string) => {
              const previous = track!.recent.find((r) => r.kind === kind);
              if (!previous || time - previous.at > 1200) {
                track!.recent = [...track!.recent.filter((r) => r.kind !== kind), { kind, note, at: time }];
              }
            };
            if (Math.abs(o.torso.angle - earlier.torso.angle) >= 35) record('tilt', `${track.label}: rapid torso-angle change over ${(dt / 1000).toFixed(1)} seconds (image-plane observation, not an action classification).`);
            if ((o.torso.y - earlier.torso.y) / Math.max(.025, earlier.torso.length) >= .35) record('down', `${track.label}: downward image movement over ${(dt / 1000).toFixed(1)} seconds (camera movement or normal activity may explain it).`);
          }
          track.recent = track.recent.filter((r) => time - r.at <= 5000).slice(-2);
          notes.push(...track.recent.map((r) => `${r.note} Observed ${((time - r.at) / 1000).toFixed(1)} seconds ago.`));
          track.samples.push({ time, torso: o.torso });
          track.samples = track.samples.slice(-MAX_SAMPLES);
          if (o.torso.horizontal) track.horizontalSince ??= time;
          else track.horizontalSince = null;
        }
        const horizontalMs = track.horizontalSince === null ? 0 : time - track.horizontalSince;
        return {
          id: track.id, label: track.label, box: o.box, detectionIndex: o.detectionIndex, poseIndex: o.poseIndex,
          status: limited ? 'uncertain' : !o.torso ? 'missing-pose' : isNew ? 'new' : 'tracked',
          posture: !o.torso || limited ? 'unavailable' : o.torso.horizontal ? 'horizontal' : o.torso.angle >= 30 ? 'tilted' : 'upright',
          horizontalMs, observedMs: time - track.since, observations: notes, limitations,
        };
      });
      // No re-identification: even a one-frame disappearance retires the label and history.
      for (const track of tracks.values()) if (!updated.has(track.id)) tracks.delete(track.id);
      const limitations = [...TRACKING_LIMITATIONS];
      if (!persons.length) limitations.unshift('No person has sufficient visible evidence for a posture or movement assessment.');
      if (persons.some((p) => p.status === 'uncertain')) limitations.unshift('Association or motion is ambiguous; affected histories were not used for temporal scoring.');
      if (persons.some((p) => p.status === 'missing-pose')) limitations.unshift('Some detected people lack a usable pose. The configured pose model processes at most three poses per frame.');
      return { persons, quality: persons.length > 0 && persons.every((p) => p.status === 'tracked') ? 'observing' : 'limited', limitations };
    },
  };
}
