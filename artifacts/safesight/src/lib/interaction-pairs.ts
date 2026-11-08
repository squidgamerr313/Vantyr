/**
 * Research-only causal pair candidates. IDs mean geometric continuity, not
 * verified identity, contact, ownership, intent, or eligibility for a response.
 * V1 remains immutable; this is a different input contract requiring retraining.
 */
import type { ImageJoint, InteractionFrame } from "./interaction-features";

export const PAIR_CONTRACT = "mp33-image-pairs-masked-8hz-16past-v2";
const JOINTS = [11, 12, 13, 14, 15, 16];
type Point = [number, number];
type Detection = { pose: ImageJoint[]; root: Point; scale: number };
type Track = Detection & { id: number; last: number };
type Row = { timeMs: number; people: Map<number, Detection> };
export type PairWindow = {
  contract: typeof PAIR_CONTRACT;
  pair: number[];
  startMs: number;
  latestTimeMs: number;
  features: number[][];
  box: number[];
  observedFrames: number[];
};
export const visibleJoint = (p: ImageJoint | undefined): p is ImageJoint =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
  && Number.isFinite(p.visibility) && p.visibility! >= .6 && p.visibility! <= 1;
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function detection(pose: ImageJoint[], width: number, height: number): Detection | null {
  if (pose.length !== 33 || !visibleJoint(pose[11]) || !visibleJoint(pose[12])) return null;
  // Wrists/elbows may be absent; their individual masks stay zero.
  const pixel = (j: number): Point => [pose[j]!.x * width, pose[j]!.y * height];
  const scale = distance(pixel(11), pixel(12));
  if (scale < 8) return null;
  return { pose, root: midpoint(pixel(11), pixel(12)), scale };
}

function encode(rows: Row[], pair: number[], width: number, height: number): PairWindow | null {
  const observedFrames = pair.map(id => rows.filter(r => r.people.has(id)).length);
  if (observedFrames.some(n => n < 12) || pair.some(id => !rows.at(-1)!.people.has(id))) return null;
  for (const id of pair) {
    let gap = 0;
    for (const row of rows) {
      gap = row.people.has(id) ? 0 : gap + 1;
      if (gap > 2) return null;
    }
  }
  const detections = rows.flatMap(r => pair.flatMap(id => r.people.has(id) ? [r.people.get(id)!] : []));
  // Fixed window origin is based solely on observed shoulders. No invented
  // location for absent frames; missing actors have all channels masked.
  const centre: Point = [median(detections.map(p => p.root[0])), median(detections.map(p => p.root[1]))];
  const lengths: number[] = [];
  const bounds: Point[] = [];
  for (const { pose } of detections) {
    for (const [a, b] of [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]]) {
      if (visibleJoint(pose[a!]) && visibleJoint(pose[b!])) lengths.push(
        Math.hypot((pose[a!]!.x - pose[b!]!.x) * width, (pose[a!]!.y - pose[b!]!.y) * height));
    }
    for (const p of pose) if (visibleJoint(p)) bounds.push([p.x * width, p.y * height]);
  }
  const scale = median(lengths);
  if (!Number.isFinite(scale) || scale < 8) return null;
  const features = Array.from({ length: 36 }, () => [] as number[]);
  for (const row of rows) {
    let c = 0;
    for (const id of pair) for (const joint of JOINTS) {
      const p = row.people.get(id)?.pose[joint], visible = visibleJoint(p);
      const x = visible ? (p.x * width - centre[0]) / scale : 0;
      const y = visible ? (p.y * height - centre[1]) / scale : 0;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.max(Math.abs(x), Math.abs(y)) > 30) return null;
      features[c++]!.push(x);
      features[c++]!.push(y);
      features[c++]!.push(visible ? 1 : 0);
    }
  }
  return { contract: PAIR_CONTRACT, pair, startMs: rows[0]!.timeMs,
    latestTimeMs: rows.at(-1)!.timeMs, features, observedFrames,
    box: [Math.min(...bounds.map(p => p[0])), Math.min(...bounds.map(p => p[1])),
      Math.max(...bounds.map(p => p[0])), Math.max(...bounds.map(p => p[1]))] };
}

export function createInteractionPairs() {
  let tracks: Track[] = [], rows: Row[] = [], nextId = 1, previous: InteractionFrame | undefined;
  const reset = () => { tracks = []; rows = []; previous = undefined; };
  return {
    reset,
    push(frame: InteractionFrame): { windows: PairWindow[]; reason: string | null; supportedPoses: number } {
      const badGeometry = ![frame.width, frame.height].every(n => Number.isFinite(n) && n >= 32);
      const badTime = !Number.isFinite(frame.timeMs) || frame.timeMs < 0;
      if (badGeometry || badTime || frame.landmarks.length > 3) {
        reset();
        return { windows: [], reason: "Invalid frame geometry, time or pose count", supportedPoses: 0 };
      }
      if (previous && (frame.width !== previous.width || frame.height !== previous.height
        || frame.timeMs - previous.timeMs < 75 || frame.timeMs - previous.timeMs > 175)) reset();
      previous = frame;
      const diagonal = Math.hypot(frame.width, frame.height);
      tracks = tracks.filter(t => frame.timeMs - t.last <= 3 * 175);
      const detections = frame.landmarks.map(p => detection(p, frame.width, frame.height)).filter(p => p !== null);
      // Exhaustive one-to-one assignment for at most three poses. Maximize
      // supported matches, then minimize geometric cost; no greedy ownership.
      const options: { ids: number[]; matches: number; cost: number }[] = [];
      function assign(i: number, ids: number[], used: Set<number>, matches: number, cost: number) {
        if (i === detections.length) { options.push({ ids, matches, cost }); return; }
        assign(i + 1, [...ids, -1], used, matches, cost);
        const d = detections[i]!;
        for (const t of tracks) {
          const dt = (frame.timeMs - t.last) / 125;
          const travel = distance(d.root, t.root) / diagonal;
          const ratio = d.scale / t.scale;
          if (used.has(t.id) || travel > .12 * dt || ratio < .5 || ratio > 2) continue;
          assign(i + 1, [...ids, t.id], new Set([...used, t.id]), matches + 1,
            cost + travel + .02 * Math.abs(Math.log(ratio)));
        }
      }
      assign(0, [], new Set(), 0, 0);
      options.sort((a, b) => b.matches - a.matches || a.cost - b.cost);
      const best = options[0]!, second = options[1];
      const ambiguous = !!second && best.matches > 0 && best.matches === second.matches && second.cost - best.cost < .015;
      if (ambiguous) {
        tracks = []; rows = [];
        // Drop ambiguous evidence instead of seeding new IDs at the crossing.
        return { windows: [], reason: "Ambiguous person association; pair history cleared", supportedPoses: detections.length };
      }
      const people = new Map<number, Detection>();
      detections.forEach((d, i) => {
        const id = best.ids[i] === -1 ? nextId++ : best.ids[i]!;
        tracks = tracks.filter(t => t.id !== id);
        tracks.push({ ...d, id, last: frame.timeMs });
        people.set(id, d);
      });
      // Keep at most two missed frames, regardless of wall-clock gap variation.
      const recent = rows.slice(-2);
      tracks = tracks.filter(t => people.has(t.id) || recent.some(r => r.people.has(t.id)));
      rows.push({ timeMs: frame.timeMs, people });
      if (rows.length > 16) rows.shift();
      const windows: PairWindow[] = [];
      if (rows.length === 16 && Math.abs(rows[15]!.timeMs - rows[0]!.timeMs - 1875) <= 75) {
        const ids = [...people.keys()].sort((a, b) => a - b);
        for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
          const candidate = encode(rows, [ids[a]!, ids[b]!], frame.width, frame.height);
          if (candidate) windows.push(candidate);
        }
      }
      return { windows, reason: windows.length ? null : "Insufficient observed pair history", supportedPoses: detections.length };
    },
  };
}
