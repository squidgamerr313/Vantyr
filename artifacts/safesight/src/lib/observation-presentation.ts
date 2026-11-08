import type { MotionEvidence } from './motion-evidence.ts';
import type { RiskAssessment } from './risk.ts';
import type { SafetyEvent, RiskLevel, Source } from './store.ts';
import type { ContextDecision } from './context-decision.ts';

export type ObservationAvailability = 'available' | 'waiting' | 'stopped' | 'unavailable' | 'stale';
export interface ObservationPresentation {
  recorded: boolean;
  source: Source | null;
  sourceLabel: string;
  sourceHint: string;
  headline: string;
  observed: string[];
  unknown: string[];
  checks: string[];
  technical: { score: number; level: RiskLevel | 'uncertain' } | null;
  originalEvidence: string[];
  timing: string;
  decision?: ContextDecision;
}
interface Input {
  source?: Source;
  recorded?: boolean;
  availability?: ObservationAvailability;
  evidence?: readonly string[];
  motion?: MotionEvidence;
  score?: number | null;
  level?: RiskLevel | 'uncertain';
  decision?: ContextDecision;
}
const unique = (items: string[]) => [...new Set(items.filter((s) => s.trim()))];
const BOUNDARY = 'Posture and image movement do not establish a fall, push, injury or intent.';

/** Presentation only: no mutations, scoring, detector inference or persistence. */
export function presentObservation(input: Input): ObservationPresentation {
  const recorded = input.recorded ?? false;
  const source = input.source ?? null;
  const availability = input.availability ?? 'available';
  const originalEvidence = [...(input.evidence ?? [])];
  const base = {
    recorded, source, originalEvidence,
    sourceLabel: source === 'demo' ? recorded ? 'Saved simulation' : 'Scripted simulation'
      : source === 'live' ? recorded ? 'Saved camera observation' : 'Camera observation' : 'No active source',
    sourceHint: recorded ? 'Saved in this browser. This is not a current safety assessment.'
      : source === 'demo' ? 'Scripted inputs over a generated image, not live camera inference.'
      : source === 'live' ? 'On-device object and pose observations, not verified harm recognition.' : 'No current scene is being assessed.',
    timing: input.decision?.frameTimeMs !== undefined && input.decision.frameTimeMs !== null
      ? source === 'demo' ? 'Scripted simulation timing, not real-camera evidence.' : 'Durations use decoded video timestamps; timing describes this observation, not a human outcome.'
      : input.motion?.timestampBasis === 'decoded-video' ? 'Durations use decoded video timestamps.'
      : input.motion?.timestampBasis === 'simulation' ? 'Scripted simulation timing, not real-camera evidence.'
      : input.motion?.timestampBasis === 'processing-time' ? 'Processing-time durations; decoded video timing was unavailable.'
      : recorded ? 'Structured person labels, measured durations and timing details were not recorded.' : 'Timing details are unavailable.',
  };
  if (availability !== 'available') {
    const headline = availability === 'stopped' ? 'Monitoring is stopped'
      : availability === 'waiting' ? 'No observation yet' : availability === 'stale' ? 'Evidence is stale — cannot assess' : 'No current assessment available';
    return { ...base, sourceHint: 'No current scene is being assessed.', headline, observed: [availability === 'stopped' ? 'No current scene observation is available.'
      : availability === 'waiting' ? 'No input has been assessed for this session yet.' : availability === 'stale' ? 'Previous evidence is no longer current and is not shown as a scene assessment.' : 'Current scene evidence is unavailable.'],
    unknown: ['An absent assessment does not establish that the environment is safe.'],
    checks: [availability === 'stopped' ? 'Start the camera for on-device observations, or replay the labeled simulation.'
      : availability === 'waiting' ? 'Wait for input to be assessed before interpreting the scene.' : 'Check the camera or model status and retry before relying on an assessment.'],
    timing: 'No current evidence timing is available.', originalEvidence: [], technical: null };
  }

  const motion = input.motion;
  if (input.decision) {
    const d = input.decision;
    return { ...base, decision: d,
      headline: d.freshness === 'unavailable' ? 'Evidence unavailable — cannot assess'
        : d.priority === 'check' ? 'Human check suggested' : d.priority === 'context' ? 'Scene context observed' : 'No human-check rule triggered',
      observed: d.facts.length ? d.facts.map((f) => f.description) : ['No usable structured observation. This is not a safety verdict.'],
      unknown: [...d.unknowns], checks: [...d.reasons, ...d.checks], technical: null,
    };
  }
  const limited = motion?.quality === 'limited';
  const horizontal = (motion?.persons ?? []).filter((p) =>
    p.id !== null && (p.status === 'tracked' || p.status === 'new') && p.posture === 'horizontal' &&
    Number.isFinite(p.horizontalMs) && p.horizontalMs >= 0);
  const observed: string[] = horizontal.map((p) => `${p.label}: near-horizontal torso for ${(p.horizontalMs / 1000).toFixed(1)} seconds.`);
  const unknown = [BOUNDARY];
  const checks: string[] = [];
  if (horizontal.length) {
    unknown.push('Near-horizontal posture can be normal activity or intentional lying down.');
    checks.push('Check whether the person needs assistance; do not infer injury from posture alone.');
  }
  let proximity = false, count = false;
  for (const text of originalEvidence) {
    // Recognize only the current rule's explicit observation clause. Unrecognized
    // legacy prose stays verbatim in original evidence, not promoted into a fact.
    const tool = text.match(/^(.+ and a (?:knife|scissors) appear close in the image)\. Depth and intent are unknown; verify handling\.$/);
    const crowd = text.match(/^(\d+ people detected in frame)\. Check access routes; this alone does not establish overcrowding\.$/);
    if (tool) { proximity = true; observed.push(`${tool[1]}.`); }
    if (crowd) { count = true; observed.push(`${crowd[1]}.`); }
  }
  if (proximity) {
    unknown.push('Image proximity is not measured physical distance. Depth and intent are unknown.');
    checks.push('Verify how the object is being handled and whether there is actual risk.');
  }
  if (count) {
    unknown.push('A person count alone does not establish overcrowding.');
    checks.push('Check that access routes remain clear.');
  }
  if (!observed.length) {
    for (const p of motion?.persons ?? []) {
      if (p.id !== null && (p.status === 'tracked' || p.status === 'new') && (p.posture === 'upright' || p.posture === 'tilted')) {
        observed.push(`${p.label}: ${p.posture === 'upright' ? 'upright' : 'tilted'} torso observed.`);
      }
    }
  }
  for (const p of motion?.persons ?? []) {
    if (p.id === null || (p.status !== 'tracked' && p.status !== 'new')) continue;
    for (const note of p.observations) {
      if (note.startsWith(`${p.label}: rapid torso-angle change`) || note.startsWith(`${p.label}: downward image movement`)) observed.push(note);
    }
  }
  if (input.score === 0) observed.push('No configured rule triggered. This is not a safety verdict.');
  if (!motion) {
    unknown.push('Structured person labels and measured durations are unavailable; do not infer them from the score.');
  } else if (limited) {
    unknown.push('Person tracking is limited or still being established. Missing or ambiguous poses cannot establish safety.');
  }
  if (!observed.length) observed.push(recorded ? 'Structured observation details were not saved. Review the original recorded evidence below.'
    : 'No usable person posture or recognized rule observation is available.');
  if (!checks.length) checks.push(!motion ? 'Review the original evidence and check the situation; the score alone does not explain what happened.'
    : limited ? 'Check the camera view and wait for clear person evidence before interpreting posture.'
    : 'Continue normal supervision; a low rule score is not proof of safety.');
  const validScore = typeof input.score === 'number' && Number.isFinite(input.score) && input.score >= 0 && input.score <= 100;
  return { ...base,
    headline: horizontal.length ? 'Near-horizontal posture observed' : proximity ? 'Image proximity observed'
      : count ? 'Person count observed' : limited ? 'Person evidence is limited' : input.score === 0 ? 'No configured rule triggered'
      : recorded ? 'Review the recorded evidence' : 'Observation needs context',
    observed: unique(observed), unknown: unique(unknown), checks: unique(checks),
    technical: validScore && input.level ? { score: input.score as number, level: input.level } : null,
  };
}

export function presentCurrentObservation(assessment: RiskAssessment | null, source?: Source, availability: ObservationAvailability = 'available', timestampBasis: MotionEvidence['timestampBasis'] = 'processing-time') {
  return presentObservation({
    source, availability: assessment ? availability : availability === 'available' ? 'waiting' : availability,
    evidence: assessment?.evidence, score: assessment?.score,
    decision: assessment?.decision,
    level: assessment?.score === 0 && assessment.tracking.quality === 'limited' ? 'uncertain' : assessment?.level,
    motion: assessment ? {
      version: 'person-motion-v1', timestampBasis: source === 'demo' ? 'simulation' : timestampBasis,
      quality: assessment.tracking.quality, persons: assessment.tracking.persons, limitations: assessment.tracking.limitations,
    } : undefined,
  });
}

export function presentSavedObservation(event: SafetyEvent) {
  // This presenter is deliberately not an AI-review or zone-event interpreter.
  if (event.kind !== 'risk') throw new Error('Only saved risk observations use this presentation.');
  return presentObservation({ recorded: true, source: event.source, evidence: event.evidence, motion: event.motion, score: event.score, level: event.level, decision: event.decision });
}
