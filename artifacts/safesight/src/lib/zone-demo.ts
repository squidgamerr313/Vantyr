import type { VisionResult } from './vision.ts';
import type { ZoneConfig } from './zone-records.ts';
import { simulateFrame } from './overlay.ts';
export type ZoneScenario = 'brief' | 'sustained';
export type DemoScenario = 'scene' | ZoneScenario;
export const DEMO_ZONE: Omit<ZoneConfig, 'id'> = { name: 'Bench A', rect: [.55, .5, .3, .35], dwellSec: 4 };
/** Zone scenarios are additive; the ordinary Simulation control retains the original scene/poses. */
export function simulateDemoFrame(t: number, scenario: DemoScenario = 'scene', scenarioStartedAt = 0): VisionResult {
  return scenario === 'scene' ? simulateFrame(t) : simulateZoneFrame(Math.max(0, t - scenarioStartedAt), scenario);
}
/** No recorded action or model output: one explicitly scripted bounding box. No automatic review. */
export function simulateZoneFrame(t: number, scenario: ZoneScenario): VisionResult {
  const travel = Math.min(1, Math.max(0, (t - 1000) / 1400));
  const returnTravel = scenario === 'brief' ? Math.min(1, Math.max(0, (t - 3600) / 1400)) : 0;
  const x = .35 + .35 * travel - .35 * returnTravel;
  return {
    detections: [{ id: 'zone-demo-person', label: 'person', confidence: .99, box: [(x - .06) * 1536, .2 * 864, .12 * 1536, .55 * 864] }],
    landmarks: [], latency: 0, frameTimeMs: t,
  };
}
