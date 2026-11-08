import type { PosePoint, VisionResult } from './vision.ts';

export type Box = [number, number, number, number];
export type Torso = { x: number; y: number; angle: number; length: number; horizontal: boolean };
export type PersonObservation = { box: Box; detectionIndex: number | null; poseIndex: number | null; torso: Torso | null; ambiguous: boolean };
export const MAX_PEOPLE = 20;
export const MAX_POSES = 3;
export const center = (b: Box) => [b[0] + b[2] / 2, b[1] + b[3] / 2] as const;
export function overlap(a: Box, b: Box) {
  const area = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return area / Math.max(.00001, a[2] * a[3] + b[2] * b[3] - area);
}
export function spatialCost(a: Box, b: Box) {
  const ac = center(a), bc = center(b);
  const distance = Math.hypot(ac[0] - bc[0], ac[1] - bc[1]) / Math.max(.15, Math.hypot(a[2], a[3]), Math.hypot(b[2], b[3]));
  const ratio = a[2] * a[3] / Math.max(.00001, b[2] * b[3]);
  return distance <= .75 && ratio >= 1 / 6 && ratio <= 6 ? distance + .35 * (1 - overlap(a, b)) : Infinity;
}
/** Only accept mutual, separated best matches. Ambiguity is not an identity decision. */
export function uniqueMatches(costs: number[][], columns: number, margin = .12) {
  const ambiguousRows = new Set<number>(), ambiguousCols = new Set<number>();
  const best = (values: number[], ambiguous: Set<number>, index: number) => {
    const ranked = values.map((cost, i) => ({ cost, i })).filter((v) => Number.isFinite(v.cost)).sort((a, b) => a.cost - b.cost);
    if (ranked.length > 1 && ranked[1]!.cost - ranked[0]!.cost < margin) ambiguous.add(index);
    return ranked[0]?.i ?? -1;
  };
  const rows = costs.map((row, i) => best(row, ambiguousRows, i));
  const cols = Array.from({ length: columns }, (_, j) => best(costs.map((row) => row[j]!), ambiguousCols, j));
  const pairs = rows.flatMap((j, i) => j >= 0 && cols[j] === i && !ambiguousRows.has(i) && !ambiguousCols.has(j) ? [[i, j] as const] : []);
  return { pairs, ambiguousRows, ambiguousCols };
}
function visible(p: PosePoint | undefined): p is PosePoint {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -.1 && p.x <= 1.1 &&
    p.y >= -.1 && p.y <= 1.1 && Number.isFinite(p.visibility) && p.visibility! > .6;
}
function geometry(points: PosePoint[], aspect: number) {
  const torso = [points[11], points[12], points[23], points[24]];
  if (!torso.every(visible)) return null;
  const sx = (points[11]!.x + points[12]!.x) / 2, sy = (points[11]!.y + points[12]!.y) / 2;
  const hx = (points[23]!.x + points[24]!.x) / 2, hy = (points[23]!.y + points[24]!.y) / 2;
  const dx = Math.abs(sx - hx), dy = Math.abs(sy - hy);
  const length = Math.hypot(dx * aspect, dy);
  if (length < .025) return null;
  const good = points.slice(0, 33).filter(visible);
  const xs = good.map((p) => p.x), ys = good.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const box: Box = [minX - .04, minY - .04, Math.max(.08, Math.max(...xs) - minX + .08), Math.max(.08, Math.max(...ys) - minY + .08)];
  return { box, torso: { x: (sx + hx) / 2, y: (sy + hy) / 2, angle: Math.atan2(dx * aspect, dy) * 180 / Math.PI, length, horizontal: dx * aspect > dy * 1.5 && dx > .08 } };
}

export function observePeople(frame: VisionResult, width: number, height: number): PersonObservation[] {
  const people: PersonObservation[] = frame.detections.slice(0, MAX_PEOPLE).flatMap((d, i) => {
    const [x, y, w, h] = d.box;
    return d.label === 'person' && d.confidence >= .55 && d.box.every(Number.isFinite) && w > 0 && h > 0 ?
      [{ box: [x / width, y / height, w / width, h / height] as Box, detectionIndex: i, poseIndex: null, torso: null, ambiguous: false }] : [];
  });
  const poses = frame.landmarks.slice(0, MAX_POSES).flatMap((points, index) => {
    const g = geometry(points, width / height);
    return g ? [{ ...g, index }] : [];
  });
  const costs = poses.map((p) => people.map((o) => {
    const [x, y, w, h] = o.box;
    if (p.torso.x < x - .02 || p.torso.x > x + w + .02 || p.torso.y < y - .02 || p.torso.y > y + h + .02) return Infinity;
    const c = center(o.box);
    return .5 * (1 - overlap(p.box, o.box)) + Math.hypot(c[0] - p.torso.x, c[1] - p.torso.y) / Math.max(.15, Math.hypot(w, h));
  }));
  const matches = uniqueMatches(costs, people.length);
  const used = new Set<number>();
  for (const [pi, oi] of matches.pairs) {
    const pose = poses[pi]!, observation = people[oi]!;
    observation.poseIndex = pose.index; observation.torso = pose.torso; used.add(pi);
  }
  for (let i = 0; i < poses.length; i++) {
    if (used.has(i)) continue;
    if (costs[i]!.some(Number.isFinite)) {
      // Never turn an ambiguous pose into a second, fictitious person.
      people.forEach((o, j) => { if (Number.isFinite(costs[i]![j])) { o.ambiguous = true; o.torso = null; o.poseIndex = null; } });
    } else {
      const pose = poses[i]!;
      people.push({ box: pose.box, detectionIndex: null, poseIndex: pose.index, torso: pose.torso, ambiguous: false });
    }
  }
  return people.slice(0, MAX_PEOPLE);
}
