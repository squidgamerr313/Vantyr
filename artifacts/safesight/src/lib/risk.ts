import type { VisionResult } from './vision.ts';
import { createPersonTracker, TRACK_GAP_MS, TRACKING_LIMITATIONS, type TrackingSummary } from './person-tracking.ts';

export interface RiskAssessment {
  /** Separate human-check decision; score below remains frozen legacy diagnostics. */
  decision?: import('./context-decision.ts').ContextDecision;
  level: 'low' | 'moderate' | 'high';
  score: number;
  evidence: string[];
  tracking: TrackingSummary;
}
type Source = 'live' | 'demo';
export function createRiskAssessor() {
  const tracker = createPersonTracker();
  let lastFrameTime: number | null = null;
  let lastWallTime: number | null = null;
  let source: Source | null = null;
  let aspect: number | null = null;
  let cached: RiskAssessment | null = null;
  const reset = () => { tracker.reset(); lastFrameTime = null; lastWallTime = null; source = null; aspect = null; cached = null; };
  const unknown = (message: string): RiskAssessment => ({
    level: 'low', score: 0, evidence: [message, 'Insufficient evidence is not evidence that the environment is safe.'],
    tracking: { quality: 'limited', persons: [], limitations: [...TRACKING_LIMITATIONS] },
  });
  return {
    reset, stats: tracker.stats,
    assess(result: VisionResult, width: number, height: number, now: number, options: { source?: Source; onTrackingTiming?: (ms: number) => void } = {}): RiskAssessment {
      const invalidate = () => { tracker.invalidate(); lastFrameTime = null; lastWallTime = null; cached = null; };
      if (![width, height, now].every(Number.isFinite) || width <= 0 || height <= 0) { invalidate(); return unknown('Invalid frame dimensions or timestamp. Temporal assessment is unavailable.'); }
      const nextSource = options.source ?? 'live';
      const time = result.frameTimeMs ?? now;
      if (!Number.isFinite(time)) { invalidate(); return unknown('Frame timestamp is unavailable. Temporal assessment is uncertain.'); }
      if (source === nextSource && result.frameTimeMs !== undefined && time === lastFrameTime && cached) {
        if (lastWallTime !== null && now - lastWallTime > TRACK_GAP_MS) {
          tracker.invalidate(); cached = unknown('The decoded frame is stale. Temporal assessment is uncertain until a fresh frame arrives.');
        }
        return cached;
      }
      if (source !== nextSource) reset();
      else if ((aspect !== null && Math.abs(width / height - aspect) > .1) ||
          (lastFrameTime !== null && (time < lastFrameTime || time - lastFrameTime > TRACK_GAP_MS)) ||
          (lastWallTime !== null && (now < lastWallTime || now - lastWallTime > TRACK_GAP_MS))) invalidate();
      source = nextSource; aspect = width / height;
      lastFrameTime = time; lastWallTime = now;
      const trackingStart = options.onTrackingTiming ? performance.now() : 0;
      const tracking = tracker.update(result, width, height, time);
      options.onTrackingTiming?.(performance.now() - trackingStart);
      const evidence: string[] = [];
      let score = 0;
      const objects = result.detections.slice(0, 20).filter((d) => d.confidence >= .55 && d.box.every(Number.isFinite) && d.box[2] > 0 && d.box[3] > 0);
      const people = objects.filter((d) => d.label === 'person');
      const sharp = objects.filter((d) => d.label === 'knife' || d.label === 'scissors');
      for (const person of people) for (const item of sharp) {
        const distance = Math.hypot((person.box[0] + person.box[2] / 2 - item.box[0] - item.box[2] / 2) / width,
          (person.box[1] + person.box[3] / 2 - item.box[1] - item.box[3] / 2) / height);
        if (distance < .3) {
          score = Math.max(score, 48);
          const index = result.detections.indexOf(person);
          const label = tracking.persons.find((p) => p.detectionIndex === index)?.label ?? 'A person';
          evidence.push(`${label} and a ${item.label} appear close in the image. Depth and intent are unknown; verify handling.`);
        }
      }
      if (people.length >= 4) { score = Math.max(score, 35); evidence.push(`${people.length} people detected in frame. Check access routes; this alone does not establish overcrowding.`); }
      for (const person of tracking.persons) {
        if (person.posture === 'horizontal') {
          if (person.horizontalMs >= 2000) score = Math.max(score, person.horizontalMs >= 5000 ? 72 : 52);
          evidence.push(`${person.label}: near-horizontal torso for ${(person.horizontalMs / 1000).toFixed(1)} seconds. Could be normal activity or intentional lying down; this is not a confirmed fall.`);
        }
        evidence.push(...person.observations);
      }
      if (!score) evidence.push('No configured risk heuristic triggered. This does not mean the environment is safe.');
      if (tracking.quality === 'limited') evidence.push('Tracking evidence is limited or still being established. Missing or ambiguous poses cannot establish safety.');
      cached = { level: score >= 70 ? 'high' : score >= 30 ? 'moderate' : 'low', score, evidence: [...new Set(evidence)].slice(0, 32), tracking };
      return cached;
    },
  };
}
const current = createRiskAssessor();
export const assessRisk = current.assess;
export const resetRisk = current.reset;
