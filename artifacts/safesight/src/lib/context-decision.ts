import type { VisionResult } from './vision.ts';
import type { TrackingSummary } from './person-tracking.ts';
import type { Source } from './store.ts';
import { TRACK_GAP_MS } from './person-tracking.ts';
import { validZone, type ZoneProgress } from './zone-monitor.ts';
import type { ZoneConfig } from './zone-records.ts';

export type ReviewPriority = 'none' | 'context' | 'check';
export interface CheckTrigger { episodeId: string; personId: string; label: string; reason: string }
export interface DecisionFact {
  kind: 'posture' | 'person-count' | 'tool-proximity';
  owner: string | null;
  association: 'anonymous-person' | 'image-only' | 'scene';
  elapsedMs: number | null;
  description: string;
}
/** Scalar/text metadata only. Never store detections, landmarks, media or buffers. */
export interface ContextDecision {
  version: 'context-v1';
  sessionId: string;
  source: Source;
  frameTimeMs: number | null;
  freshness: 'fresh' | 'unavailable';
  quality: TrackingSummary['quality'];
  facts: DecisionFact[];
  zone: { id: string; name: string; dwellSec: number; status: ZoneProgress['status']; occupants: { personId: string; dwellMs: number; flagged: boolean }[] } | null;
  priority: ReviewPriority;
  reasons: string[];
  unknowns: string[];
  checks: string[];
  episodes: string[];
  triggers: CheckTrigger[];
  fallState: 'unavailable';
}
export interface DecisionInput {
  result: VisionResult; tracking: TrackingSummary; width: number; height: number;
  now: number; source: Source; sessionId: string;
  zone?: { config: ZoneConfig | null; progress: ZoneProgress };
  blockedReason?: string;
}
const BASE_UNKNOWN = [
  'Fall, sustained person-down, observed recovery and interpersonal-action recognition are unavailable: no candidate passed all admission gates.',
  'Anonymous image tracks are not verified identities. Posture, movement, crowd count and tool proximity do not establish harm or intent.',
  'Visible posture changes, departure and visibility loss do not resolve a human review. No automatic emergency escalation is performed.',
];

export function createContextDecisionLayer() {
  let key = '', lastFrame: number | null = null, lastWall: number | null = null, aspect: number | null = null;
  let counter = 0;
  let previous: ContextDecision | null = null;
  const people = new Map<string, { episode: string; fired: boolean; uprightSince: number | null; horizontalSince: number | null }>();
  function reset() { people.clear(); key = ''; lastFrame = lastWall = aspect = null; previous = null; }
  return {
    reset,
    decide(input: DecisionInput): ContextDecision {
      const { result, tracking, width, height, source, sessionId, now } = input;
      const time = result.frameTimeMs;
      const nextKey = `${source}:${sessionId}`;
      const valid = Number.isFinite(time) && time! >= 0 && Number.isFinite(now) &&
        Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && !!sessionId;
      const base = (): ContextDecision => ({
        version: 'context-v1', sessionId, source, frameTimeMs: valid ? time! : null,
        freshness: valid ? 'fresh' : 'unavailable', quality: tracking.quality,
        facts: [], zone: null, priority: 'none', reasons: [], unknowns: [...BASE_UNKNOWN],
        checks: ['Continue human supervision. An absent check request is not evidence of safety.'],
        episodes: [], triggers: [], fallState: 'unavailable',
      });
      if (!valid || input.blockedReason) { reset(); return { ...base(), freshness: 'unavailable', quality: 'limited',
        reasons: [input.blockedReason ?? 'Decoded evidence time or dimensions are unavailable; temporal checks are withheld.'] }; }
      if (key === nextKey && lastFrame === time && previous) {
        if (lastWall !== null && now >= lastWall && now - lastWall <= TRACK_GAP_MS)
          return { ...previous, episodes: [], triggers: [] }; // one check per fresh episode, never per render
        reset();
        return { ...base(), freshness: 'unavailable', quality: 'limited', reasons: ['Repeated decoded evidence is stale; continuity was discarded.'] };
      }
      if (key !== nextKey || (aspect !== null && Math.abs(width / height - aspect) > .01) ||
          (lastFrame !== null && (time! < lastFrame || time! - lastFrame > TRACK_GAP_MS)) ||
          (lastWall !== null && (now < lastWall || now - lastWall > TRACK_GAP_MS))) {
        reset();
      }
      // Tracking owns posture duration. After a local reset only a fresh contiguous
      // window may qualify, even if a caller supplies an old tracking duration.
      const firstFrame = lastFrame === null;
      key = nextKey; aspect = width / height; lastFrame = time!; lastWall = now;
      const decision = base();
      const seen = new Set<string>();
      for (const p of tracking.persons.slice(0, 20)) {
        if (!p.id || !['new', 'tracked'].includes(p.status) || p.posture === 'unavailable') continue;
        seen.add(p.id);
        let entry = people.get(p.id);
        if (!entry) { entry = { episode: `${sessionId}:${source}:${p.id}:${++counter}`, fired: false, uprightSince: null, horizontalSince: null }; people.set(p.id, entry); }
        if (p.posture === 'horizontal') entry.horizontalSince ??= time!;
        else entry.horizontalSince = null;
        const elapsedMs = p.posture === 'horizontal' ? Math.min(p.horizontalMs, time! - entry.horizontalSince!) : null;
        decision.facts.push({ kind: 'posture', owner: p.id, association: 'anonymous-person',
          elapsedMs,
          description: `${p.label}: ${p.posture === 'horizontal' ? 'near-horizontal' : p.posture} torso observed${elapsedMs !== null ? ` for ${(elapsedMs / 1000).toFixed(1)} seconds` : ''}.` });
        if (p.posture === 'upright') {
          entry.uprightSince ??= time!;
          if (time! - entry.uprightSince >= 1000 && entry.fired) {
            entry.fired = false; entry.episode = `${sessionId}:${source}:${p.id}:${++counter}`;
          }
        } else entry.uprightSince = null;
        if (!firstFrame && p.status === 'tracked' && p.posture === 'horizontal' && p.horizontalMs >= 2000 &&
            entry.horizontalSince !== null && time! - entry.horizontalSince >= 2000) {
          decision.priority = 'check';
          const reason = `${p.label}: sustained near-horizontal posture warrants a human check, not a fall diagnosis.`;
          decision.reasons.push(reason);
          if (!entry.fired) {
            decision.episodes.push(entry.episode);
            decision.triggers.push({ episodeId: entry.episode, personId: p.id, label: p.label, reason });
            entry.fired = true;
          }
        }
      }
      for (const id of people.keys()) if (!seen.has(id)) people.delete(id);
      const detections = result.detections.slice(0, 20).filter((d) => d.confidence >= .55 && d.box.every(Number.isFinite) && d.box[2] > 0 && d.box[3] > 0);
      const persons = detections.filter((d) => d.label === 'person');
      if (persons.length >= 4) decision.facts.push({ kind: 'person-count', owner: null, association: 'scene', elapsedMs: null,
        description: `${persons.length} people detected. Count alone does not establish overcrowding.` });
      for (const tool of detections.filter((d) => ['knife', 'scissors'].includes(d.label))) {
        if (persons.some((p) => Math.hypot((p.box[0] + p.box[2]/2 - tool.box[0] - tool.box[2]/2)/width,
          (p.box[1] + p.box[3]/2 - tool.box[1] - tool.box[3]/2)/height) < .3))
          decision.facts.push({ kind: 'tool-proximity', owner: null, association: 'image-only', elapsedMs: null,
            description: `A ${tool.label} and person appear close in the image. Holding, ownership, physical distance and intent are unknown.` });
      }
      const zone = input.zone;
      if (zone?.config && validZone(zone.config)) {
        decision.zone = { id: zone.config.id, name: zone.config.name, dwellSec: zone.config.dwellSec, status: zone.progress.status,
          occupants: zone.progress.occupants.slice(0, 20).map((p) => ({ personId: p.id, dwellMs: p.dwellMs, flagged: p.flagged })) };
        decision.unknowns.push('The configured zone is a 2D image rule, not verified danger, authorization or machinery status. Zone flags use their separate review workflow.');
      }
      if (decision.priority === 'none' && decision.facts.some((f) => f.kind !== 'posture')) decision.priority = 'context';
      if (decision.priority === 'check') decision.checks = ['Check whether the observed person needs assistance. Intentional lying or ordinary activity may explain the posture. Record any outcome separately in human review.'];
      else if (decision.priority === 'context') decision.checks = ['Use these scene observations as context for normal supervision; they do not trigger a danger alert.'];
      if (tracking.quality === 'limited') decision.unknowns.push('Person/posture association is limited. Missing evidence cannot establish recovery or safety.');
      previous = decision;
      return decision;
    },
  };
}
