import type { VisionEngine } from './vision.ts';
import type { createMonitoringHealth } from './monitoring-health.ts';

/** Capture the original media timestamp once; the clock may move before detect reads it. */
export function beginMonitoredInference(
  engine: VisionEngine, video: HTMLVideoElement,
  monitor: ReturnType<typeof createMonitoringHealth>, now: number, observedAt = now,
) {
  const mediaTime = video.currentTime;
  const ticket = monitor.beginInference(mediaTime, now, observedAt);
  return { ticket, inference: engine.detect(video, mediaTime * 1000, ticket.started) };
}
