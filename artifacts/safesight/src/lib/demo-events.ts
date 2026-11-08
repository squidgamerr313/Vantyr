import type { SafetyEvent } from './store.ts';

const prefix = 'vantyr-example-';
export const isExampleEvent = (event: SafetyEvent) => event.source === 'demo' && event.id.startsWith(prefix);

/** Authored workflow examples, never inference output or response triggers. */
export function createDemoEvents(now = Date.now()): SafetyEvent[] {
  const limitations = 'Authored demo example, not camera inference or a real incident. No images, audio or automatic responses are involved.';
  const posture = (key: string, ts: number): SafetyEvent => ({
    id: `${prefix}${key}`, ts, source: 'demo', kind: 'risk', level: 'uncertain', score: null,
    detections: 1, evidence: ['Demo example: Person 1 has a near-horizontal torso for 3.2 seconds.'],
    limitations, review: { status: 'open', actions: [] },
    motion: {
      version: 'person-motion-v1', timestampBasis: 'simulation', quality: 'observing',
      limitations: ['Scripted posture, not a confirmed fall or injury.'],
      persons: [{
        id: 'p1', label: 'Person 1', status: 'tracked', posture: 'horizontal',
        horizontalMs: 3200, observedMs: 5400, observations: [],
        limitations: ['Intentional lying down can produce similar posture.'],
      }],
    },
  });
  const zone = (key: string, ts: number, name: string): SafetyEvent => ({
    id: `${prefix}${key}`, ts, source: 'demo', kind: 'zone', level: 'uncertain', score: null,
    detections: 1, evidence: [`Demo example: Person 1 stayed in ${name} for 4.8 seconds against a 4-second threshold.`],
    limitations, review: { status: 'open', actions: [] },
    zone: {
      version: 'zone-v1', sessionId: 'vantyr-example-session', sessionStartedAt: now - 3600000,
      episodeId: `${prefix}${key}`, personId: 'p1', personLabel: 'Person 1', dwellMs: 4800,
      timestampBasis: 'simulation',
      zone: { id: `${prefix}${key}-zone`, name, rect: [.55, .5, .3, .35], dwellSec: 4 },
    },
  });
  const reviewed = zone('zone-reviewed', now - 1200000, 'Bench A');
  reviewed.review = { status: 'reviewed', actions: [{
    status: 'reviewed', at: reviewed.ts + 30000, outcome: 'unable-to-verify',
    note: 'Demo review: additional context is needed. The observation remains open for follow-up.',
  }] };
  const resolved = posture('posture-resolved', now - 2400000);
  resolved.review = { status: 'resolved', actions: [
    { status: 'reviewed', at: resolved.ts + 20000, outcome: 'no-assistance-needed', note: 'Demo review: intentional stretching, no assistance needed.' },
    { status: 'resolved', at: resolved.ts + 40000, confirmed: true, note: 'Demo workflow completed. This is an example human decision, not machine-verified safety.' },
  ] };
  return [posture('posture-open', now - 120000), zone('zone-open', now - 420000, 'Bench A'), reviewed, resolved];
}
