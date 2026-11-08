/** Wall-clock bounds describe evidence availability, never fabricated media samples. */
export const EVIDENCE_MAX_AGE_MS = 2500;
export type HealthPhase = 'stopped' | 'simulation' | 'requesting' | 'loading' | 'waiting' | 'fresh' | 'stale' | 'interrupted' | 'error';
export type MonitoringHealth = { phase: HealthPhase; reason: string };
type Ticket = { epoch: number; revision: number; started: number; mediaTime: number };
const REASONS: Record<HealthPhase, string> = {
  stopped: 'Camera released; no current scene is assessed.',
  simulation: 'Scripted simulation only. Live camera health is not being assessed.',
  requesting: 'Waiting for camera permission and video startup.',
  loading: 'Camera started; on-device models are loading. No assessment yet.',
  waiting: 'Waiting for a completed inference on a new decoded camera frame.',
  fresh: 'Fresh decoded camera frames and completed on-device inference.',
  stale: 'Current evidence is stale. No current assessment is available.',
  interrupted: 'Camera interrupted. Reconnect it and restart the camera.',
  error: 'Monitoring failed. Check the camera or models and retry.',
};

/** Bounded, session-owned state; clock and media facts are supplied by the caller. */
export function createMonitoringHealth(options: {
  publish: (health: MonitoringHealth) => void;
  invalidate: () => void;
}) {
  let health: MonitoringHealth = { phase: 'simulation', reason: REASONS.simulation };
  let epoch = 0, revision = 0, began = 0;
  let media: number | null = null, decodedAt: number | null = null;
  let evidenceAt: number | null = null, evidenceMedia: number | null = null;
  const active = () => ['waiting', 'fresh', 'stale'].includes(health.phase);
  const set = (phase: HealthPhase, reason = REASONS[phase]) => {
    if (health.phase === phase && health.reason === reason) return;
    if (phase === 'stale' && health.phase !== 'stale') {
      revision++; evidenceAt = null; options.invalidate();
    }
    health = { phase, reason }; options.publish(health);
  };
  const check = (now: number) => {
    if (!active()) return health;
    if (now < began || now - (decodedAt ?? began) >= EVIDENCE_MAX_AGE_MS)
      set('stale', 'Decoded camera frames stopped advancing. Check the camera view, then restart if needed.');
    else if (now - (evidenceAt ?? began) >= EVIDENCE_MAX_AGE_MS)
      set('stale', 'No fresh inference completed within 2.5 seconds. Wait for new evidence or restart the camera.');
    return health;
  };
  return {
    read: () => health,
    /** A source/start/stop/failure transition invalidates every outstanding ticket. */
    enter(phase: Exclude<HealthPhase, 'fresh' | 'stale'>, now: number, reason?: string) {
      epoch++; revision++; began = now;
      media = decodedAt = evidenceAt = evidenceMedia = null;
      set(phase, reason);
    },
    sample(ready: boolean, time: number, now: number, observedAt = now) {
      // Check the gap BEFORE observing progress: a resume cannot erase an outage.
      check(now);
      if (!active()) return health;
      if (ready && Number.isFinite(time) && time >= 0 && time !== media &&
          Number.isFinite(observedAt) && observedAt <= now && now - observedAt < EVIDENCE_MAX_AGE_MS) {
        if (media !== null && time < media) {
          if (health.phase === 'stale') { revision++; options.invalidate(); }
          set('stale', 'Camera timing changed. Waiting for new evidence; temporal history was cleared.');
          evidenceAt = evidenceMedia = null;
        }
        media = time; decodedAt = observedAt;
      }
      return health;
    },
    beginInference(time: number, now: number, observedAt = now): Ticket {
      check(now);
      return { epoch, revision, started: Number.isFinite(observedAt) && observedAt <= now ? observedAt : NaN, mediaTime: time };
    },
    complete(ticket: Ticket, frameTimeMs: number | undefined, now: number) {
      check(now);
      if (!active() || ticket.epoch !== epoch || ticket.revision !== revision ||
          !Number.isFinite(frameTimeMs) || frameTimeMs !== ticket.mediaTime * 1000 ||
           !Number.isFinite(ticket.started) || now < ticket.started || now - ticket.started >= EVIDENCE_MAX_AGE_MS ||
          decodedAt === null || now - decodedAt >= EVIDENCE_MAX_AGE_MS ||
          (evidenceMedia !== null && frameTimeMs! <= evidenceMedia)) return false;
      evidenceAt = ticket.started; evidenceMedia = frameTimeMs!;
      set('fresh');
      return true;
    },
    check,
  };
}
