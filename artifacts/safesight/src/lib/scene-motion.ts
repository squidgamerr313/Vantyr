import type { Box } from './person-geometry.ts';

/** Independent background evidence, never inferred from shared person translation. */
export type SceneMotion = {
  status: 'stable' | 'moving' | 'unknown';
  reason: string;
  support: number;
};
export const SCENE_WIDTH = 96;
export const SCENE_HEIGHT = 54;
export type SceneSample = { gray: Uint8Array; excluded: Box[]; time: number };
const unknown = (reason: string, support = 0): SceneMotion => ({ status: 'unknown', reason, support });

/** Bounded block matching on background only. No compensation or physical motion claims. */
export function estimateSceneMotion(previous: SceneSample | null, current: SceneSample): SceneMotion {
  const w = SCENE_WIDTH, h = SCENE_HEIGHT;
  if (!previous || current.gray.length !== w * h || previous.gray.length !== w * h ||
      !Number.isFinite(current.time) || !Number.isFinite(previous.time) ||
      current.time <= previous.time || current.time - previous.time > 500)
    return unknown('Independent background history is unavailable or interrupted.');
  const excluded = [...previous.excluded, ...current.excluded];
  const masked = (x: number, y: number) => excluded.some(([bx, by, bw, bh]) =>
    x / w >= bx - .1 && x / w <= bx + bw + .1 && y / h >= by - .1 && y / h <= by + bh + .1);
  const vectors: { x: number; y: number; quadrant: number }[] = [];
  for (let y = 10; y < h - 10; y += 8) for (let x = 10; x < w - 10; x += 8) {
    // The entire search/patch footprint must be outside both frames' people.
    if ([-8, 0, 8].some((dx) => [-8, 0, 8].some((dy) => masked(x + dx, y + dy)))) continue;
    let min = 255, max = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const p = previous.gray[(y + dy) * w + x + dx]!;
      min = Math.min(min, p); max = Math.max(max, p);
    }
    if (max - min < 30) continue;
    const candidates: { error: number; dx: number; dy: number }[] = [];
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      let error = 0;
      for (let py = -2; py <= 2; py++) for (let px = -2; px <= 2; px++)
        error += Math.abs(previous.gray[(y + py) * w + x + px]! - current.gray[(y + dy + py) * w + x + dx + px]!);
      candidates.push({ error: error / 25, dx, dy });
    }
    candidates.sort((a, b) => a.error - b.error);
    const best = candidates[0]!;
    const alternative = candidates.find((c) => Math.hypot(c.dx - best.dx, c.dy - best.dy) > 1.5);
    if (best.error > 18 || !alternative || alternative.error - best.error < 4 ||
        Math.abs(best.dx) === 6 || Math.abs(best.dy) === 6) continue;
    vectors.push({ x: best.dx, y: best.dy, quadrant: (x >= w / 2 ? 1 : 0) + (y >= h / 2 ? 2 : 0) });
  }
  if (vectors.length < 10) return unknown('Too little uniquely textured background outside people.', vectors.length);
  const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
  const dx = median(vectors.map((v) => v.x)), dy = median(vectors.map((v) => v.y));
  const inliers = vectors.filter((v) => Math.hypot(v.x - dx, v.y - dy) <= 1);
  if (inliers.length / vectors.length < .75 || new Set(inliers.map((v) => v.quadrant)).size < 3)
    return unknown('Background motion lacks spatially distributed agreement.', inliers.length);
  return {
    status: Math.hypot(dx, dy) < 1 ? 'stable' : 'moving',
    reason: Math.hypot(dx, dy) < 1 ? 'Distributed background patches agree within sampled resolution.' :
      'Distributed background patches show image movement. No camera compensation is applied.',
    support: inliers.length,
  };
}
