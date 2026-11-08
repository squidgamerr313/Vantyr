/**
 * Shared RGB-only research input contract. No action heuristics or risk scores.
 * Native Kinect coordinates cannot be supplied as MediaPipe image coordinates.
 */
export const INTERACTION_CONTRACT = "mp33-image-upperbody-2person-8hz-16past-v1";
export const INTERACTION_STEPS = 16;
export const INTERACTION_CHANNELS = 36;
const JOINTS = [11, 12, 13, 14, 15, 16] as const;
export type ImageJoint = { x: number; y: number; visibility?: number };
export type InteractionFrame = {
  timeMs: number;
  width: number;
  height: number;
  landmarks: ImageJoint[][];
};
type Point = [number, number];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const middle = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const observed = (p: ImageJoint | undefined) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && Math.abs(p.x) <= 1.5 && Math.abs(p.y) <= 1.5 && (p.visibility ?? 0) >= .6;

export function interactionFeatures(frames: InteractionFrame[]):
  { ok: true; contract: typeof INTERACTION_CONTRACT; features: number[][]; box: number[]; latestTimeMs: number }
  | { ok: false; reason: string } {
  if (frames.length !== INTERACTION_STEPS) return fail("Need 16 past pose frames");
  const first = frames[0]!;
  if (![first.width, first.height].every(n => Number.isFinite(n) && n >= 32)) return fail("Invalid geometry");
  let previous: Point[] | undefined;
  const rows: { people: ImageJoint[][]; roots: Point[] }[] = [], scales: number[] = [], bounds: Point[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    if (!Number.isFinite(frame.timeMs) || frame.timeMs < 0 || frame.width !== first.width || frame.height !== first.height)
      return fail("Invalid timestamp or changed geometry");
    if (i && (frame.timeMs - frames[i - 1]!.timeMs < 75 || frame.timeMs - frames[i - 1]!.timeMs > 175))
      return fail("Pose cadence is insufficient or irregular");
    if (frame.landmarks.length !== 2 || frame.landmarks.some(p => p.length !== 33))
      return fail("Need exactly two supported poses; no invented person association");
    let people = [...frame.landmarks];
    if (people.some(p => !observed(p[11]) || !observed(p[12]) || JOINTS.filter(j => observed(p[j])).length < 4))
      return fail("Upper-body evidence is incomplete");
    const pixel = (p: ImageJoint): Point => [p.x * first.width, p.y * first.height];
    let roots = people.map(p => middle(pixel(p[11]!), pixel(p[12]!)));
    if (!previous) {
      if (roots[0]![0] > roots[1]![0]) { roots.reverse(); people.reverse(); }
    } else {
      const straight = distance(previous[0]!, roots[0]!) + distance(previous[1]!, roots[1]!);
      const swapped = distance(previous[0]!, roots[1]!) + distance(previous[1]!, roots[0]!);
      const diagonal = Math.hypot(first.width, first.height);
      if (Math.abs(straight - swapped) < .015 * diagonal) return fail("Ambiguous actor continuity");
      if (swapped < straight) { roots.reverse(); people.reverse(); }
      if (roots.some((r, j) => distance(r, previous![j]!) > .2 * diagonal)) return fail("Actor continuity lost");
    }
    for (const person of people) {
      for (const [a, b] of [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]]) {
        if (observed(person[a!]) && observed(person[b!])) scales.push(distance(pixel(person[a!]!), pixel(person[b!]!)));
      }
      for (const p of person) if (observed(p)) bounds.push(pixel(p));
    }
    rows.push({ people, roots });
    previous = roots;
  }
  if (Math.abs(frames.at(-1)!.timeMs - first.timeMs - 1875) > 75) return fail("Window duration differs from training contract");
  scales.sort((a, b) => a - b);
  const scale = scales[Math.floor(scales.length / 2)] ?? 0;
  if (scale < 8 || !Number.isFinite(scale)) return fail("People too small or degenerate");
  const features = Array.from({ length: INTERACTION_CHANNELS }, () => [] as number[]);
  for (const row of rows) {
    const centre = middle(row.roots[0]!, row.roots[1]!);
    let channel = 0;
    for (const person of row.people) for (const j of JOINTS) {
      const p = person[j]!, visible = !!observed(p);
      const x = visible ? (p.x * first.width - centre[0]) / scale : 0;
      const y = visible ? (p.y * first.height - centre[1]) / scale : 0;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.max(Math.abs(x), Math.abs(y)) > 30)
        return fail("Implausible normalized pose");
      features[channel++]!.push(x);
      features[channel++]!.push(y);
      features[channel++]!.push(visible ? 1 : 0);
    }
  }
  return { ok: true, contract: INTERACTION_CONTRACT, features,
    box: [Math.min(...bounds.map(p => p[0])), Math.min(...bounds.map(p => p[1])),
      Math.max(...bounds.map(p => p[0])), Math.max(...bounds.map(p => p[1]))],
    latestTimeMs: frames.at(-1)!.timeMs };
}
