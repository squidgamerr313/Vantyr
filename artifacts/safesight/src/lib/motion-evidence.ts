import type { TrackingSummary, TrackedPerson } from './person-tracking.ts';

/** Deliberately excludes bounding boxes, landmarks, images and the per-frame buffer. */
export interface MotionEvidence {
  version: 'person-motion-v1';
  timestampBasis: 'decoded-video' | 'simulation' | 'processing-time';
  quality: TrackingSummary['quality'];
  persons: Pick<TrackedPerson, 'id' | 'label' | 'status' | 'posture' | 'horizontalMs' | 'observedMs' | 'observations' | 'limitations'>[];
  limitations: string[];
}
export function motionEvidence(tracking: TrackingSummary, timestampBasis: MotionEvidence['timestampBasis']): MotionEvidence {
  return {
    version: 'person-motion-v1', timestampBasis, quality: tracking.quality,
    persons: tracking.persons.map(({ id, label, status, posture, horizontalMs, observedMs, observations, limitations }) =>
      ({ id, label, status, posture, horizontalMs, observedMs, observations: [...observations], limitations: [...limitations] })),
    limitations: [...tracking.limitations],
  };
}
