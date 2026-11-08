import type { Preferences, SafetyEvent } from './store.ts';
import { validZone } from './zone-monitor.ts';
import { canReview, HUMAN_OUTCOMES, MAX_REVIEW_ACTIONS } from './zone-records.ts';
import { validIndividualCheck } from './context-validation.ts';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const numberIn = (v: unknown, min: number, max: number, integer = false) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v));
const boundedStrings = (v: unknown, max: number) => strings(v) && v.length <= max && v.every((s) => s.length <= 2000);
function validMotion(v: unknown) {
  return record(v) && v.version === 'person-motion-v1' && ['decoded-video', 'simulation', 'processing-time'].includes(String(v.timestampBasis)) &&
    ['observing', 'limited'].includes(String(v.quality)) && boundedStrings(v.limitations, 10) &&
    Array.isArray(v.persons) && v.persons.length <= 20 && v.persons.every((p) =>
      record(p) && (p.id === null || (typeof p.id === 'string' && /^p\d+$/.test(p.id))) &&
      typeof p.label === 'string' && p.label.length <= 80 && ['new', 'tracked', 'missing-pose', 'uncertain'].includes(String(p.status)) &&
      ['upright', 'tilted', 'horizontal', 'unavailable'].includes(String(p.posture)) &&
      numberIn(p.horizontalMs, 0, Number.MAX_SAFE_INTEGER) && numberIn(p.observedMs, 0, Number.MAX_SAFE_INTEGER) &&
      boundedStrings(p.observations, 4) && boundedStrings(p.limitations, 5));
}
function validZoneFields(v: Record<string, unknown>) {
  if (v.kind !== 'zone') return v.zone === undefined;
  const z = v.zone;
  if (!record(z) || z.version !== 'zone-v1' || !validZone(z.zone) || typeof z.sessionId !== 'string' || z.sessionId.length < 1 || z.sessionId.length > 80 ||
      !numberIn(z.sessionStartedAt, 0, Number(v.ts)) || typeof z.episodeId !== 'string' || z.episodeId.length < 1 || z.episodeId.length > 240 ||
      typeof z.personId !== 'string' || !/^p\d+$/.test(z.personId) || typeof z.personLabel !== 'string' || z.personLabel.length < 1 || z.personLabel.length > 80 ||
      !numberIn(z.dwellMs, z.zone.dwellSec * 1000, Number.MAX_SAFE_INTEGER) ||
      z.timestampBasis !== (v.source === 'demo' ? 'simulation' : 'decoded-video') ||
      v.score !== null || v.level !== 'uncertain') return false;
  return true;
}
function validReview(v: Record<string, unknown>) {
  const r = v.review;
  if (r === undefined) return true;
  if (v.kind === 'analysis' || !record(r) || !Array.isArray(r.actions) || r.actions.length > MAX_REVIEW_ACTIONS) return false;
  let state = 'open' as import('./zone-records.ts').ReviewStatus;
  let at = Number(v.ts);
  let outcome: unknown;
  for (const action of r.actions) {
    if (!record(action) || !['reviewed', 'resolved', 'dismissed'].includes(String(action.status)) ||
        !canReview(state, action.status as typeof state) || !numberIn(action.at, at, 8.64e15) ||
        typeof action.note !== 'string' || action.note.length > 1000 ||
        (action.outcome !== undefined && !HUMAN_OUTCOMES.includes(action.outcome as import('./zone-records.ts').HumanOutcome)) ||
        (action.confirmed !== undefined && (action.confirmed !== true || action.status !== 'resolved'))) return false;
    outcome = action.outcome ?? outcome;
    if (action.status === 'resolved' && (outcome === 'unable-to-verify' || (outcome !== undefined && action.confirmed !== true))) return false;
    state = action.status as typeof state; at = Number(action.at);
  }
  return r.status === state;
}

export function validEvent(v: unknown): v is SafetyEvent {
  return record(v) && typeof v.id === 'string' && v.id.length > 0 &&
    numberIn(v.ts, 0, 8.64e15) && ['live', 'demo'].includes(String(v.source)) &&
    ['risk', 'analysis', 'zone'].includes(String(v.kind)) &&
    ['low', 'moderate', 'high', 'uncertain'].includes(String(v.level)) &&
    (v.score === null || numberIn(v.score, 0, 100)) && strings(v.evidence) &&
    numberIn(v.detections, 0, Number.MAX_SAFE_INTEGER, true) &&
    (v.summary === undefined || typeof v.summary === 'string') &&
    (v.recommendations === undefined || strings(v.recommendations)) &&
    (v.limitations === undefined || typeof v.limitations === 'string') &&
    (v.motion === undefined || validMotion(v.motion)) &&
    (v.decision === undefined || (v.kind === 'risk' && validIndividualCheck(v.decision, v.source) &&
      v.score === null && v.level === 'uncertain')) &&
    validZoneFields(v) && validReview(v);
}

export function parseEvents(value: unknown): { value: SafetyEvent[]; invalid: boolean } {
  if (!Array.isArray(value)) return { value: [], invalid: true };
  const ids = new Set<string>();
  const events = value.filter((e) => {
    if (!validEvent(e) || ids.has(e.id)) return false;
    ids.add(e.id);
    return true;
  });
  return { value: events, invalid: events.length !== value.length };
}

export function parsePrefs(value: unknown, defaults: Preferences): { value: Preferences; invalid: boolean } {
  if (!record(value)) return { value: { ...defaults }, invalid: true };
  const validators: Record<keyof Preferences, (v: unknown) => boolean> = {
    facingMode: (v) => v === 'user' || v === 'environment',
    minConfidence: (v) => numberIn(v, .2, .95),
    intervalMs: (v) => numberIn(v, 40, 1000, true),
    showBoxes: (v) => typeof v === 'boolean',
    showPose: (v) => typeof v === 'boolean',
    audioAlerts: (v) => typeof v === 'boolean',
    logThreshold: (v) => v === 'low' || v === 'moderate' || v === 'high',
    logCooldownSec: (v) => numberIn(v, 1, 60, true),
    maxEvents: (v) => numberIn(v, 50, 1000, true),
  };
  const clean: Record<string, unknown> = { ...defaults };
  let invalid = false;
  for (const key of Object.keys(validators) as (keyof Preferences)[]) {
    if (!Object.hasOwn(value, key)) continue;
    if (validators[key](value[key])) clean[key] = value[key];
    else invalid = true;
  }
  return { value: clean as unknown as Preferences, invalid };
}
