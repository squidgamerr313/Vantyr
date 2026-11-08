import { overlap, type Box } from './person-geometry.ts';

export interface ObjectPrediction { class: string; score: number; bbox: Box }
const candidates = new Set(['knife', 'scissors', 'toothbrush', 'remote']);
export function detailRegions(predictions: readonly ObjectPrediction[], width: number, height: number, phase: number): Box[] {
  const regions: Box[] = [];
  for (const prediction of [...predictions].sort((a, b) => b.score - a.score)) {
    if (!candidates.has(prediction.class) || prediction.score < .2) continue;
    const [x, y, w, h] = prediction.bbox;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const side = Math.max(96, w * 2, h * 2);
    const rw = Math.min(width, side), rh = Math.min(height, side);
    const region: Box = [Math.round(Math.max(0, Math.min(width - rw, x + w / 2 - rw / 2))),
      Math.round(Math.max(0, Math.min(height - rh, y + h / 2 - rh / 2))), Math.floor(rw), Math.floor(rh)];
    if (!regions.some(r => overlap(r, region) > .65)) regions.push(region);
    if (regions.length === 2) return regions;
  }
  // If the full-frame pass misses the small item, inspect alternating
  // overlapping quadrants. These are search windows, not object predictions.
  const rw = Math.floor(width * .65), rh = Math.floor(height * .65);
  const grid: Box[] = [[0, 0, rw, rh], [width - rw, height - rh, rw, rh],
    [width - rw, 0, rw, rh], [0, height - rh, rw, rh]];
  for (let i = 0; i < 4 && regions.length < 2; i++) {
    const region = grid[(phase % 2 * 2 + i) % 4]!;
    if (region[2] >= 32 && region[3] >= 32 && !regions.some(r => overlap(r, region) > .65)) regions.push(region);
  }
  return regions;
}

/** Offset crop coordinates only; never relabel a remote/toothbrush as a tool. */
export function mapDetailPredictions(predictions: readonly ObjectPrediction[], region: Box): ObjectPrediction[] {
  return predictions.flatMap(p => {
    const [x, y, w, h] = p.bbox;
    const left = Math.max(0, Math.min(region[2], x)), top = Math.max(0, Math.min(region[3], y));
    const right = Math.max(left, Math.min(region[2], x + w)), bottom = Math.max(top, Math.min(region[3], y + h));
    return candidates.has(p.class) && Number.isFinite(p.score) && [x, y, w, h].every(Number.isFinite) && right > left && bottom > top
      ? [{ class: p.class, score: p.score, bbox: [left + region[0], top + region[1], right - left, bottom - top] as Box }] : [];
  });
}
export function mergeDetailPredictions(predictions: readonly ObjectPrediction[]): ObjectPrediction[] {
  const kept: ObjectPrediction[] = [];
  for (const p of [...predictions].sort((a, b) => b.score - a.score)) {
    if (!kept.some(k => k.class === p.class && overlap(k.bbox, p.bbox) > .4)) kept.push(p);
    if (kept.length === 30) break;
  }
  return kept;
}
