import type { ContextDecision } from './context-decision.ts';

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const list = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every((s) => text(s));
const owner = (v: unknown) => typeof v === 'string' && /^p\d+$/.test(v) && v.length <= 80;
export function validContextDecision(v: unknown): v is ContextDecision {
  if (!obj(v) || !keys(v, ['version', 'sessionId', 'source', 'frameTimeMs', 'freshness', 'quality', 'facts', 'zone', 'priority', 'reasons', 'unknowns', 'checks', 'episodes', 'triggers', 'fallState']) ||
      v.version !== 'context-v1' || !text(v.sessionId, 80) || !['live', 'demo'].includes(String(v.source)) ||
      !(v.frameTimeMs === null || num(v.frameTimeMs)) || !['fresh', 'unavailable'].includes(String(v.freshness)) ||
      !['limited', 'observing'].includes(String(v.quality)) || !['none', 'context', 'check'].includes(String(v.priority)) ||
      v.fallState !== 'unavailable' || !list(v.reasons, 20) || !list(v.unknowns, 10) || !list(v.checks, 10) ||
      !Array.isArray(v.episodes) || v.episodes.length > 20 || !v.episodes.every((s) => text(s, 240)) ||
      new Set(v.episodes).size !== v.episodes.length ||
      !Array.isArray(v.triggers) || v.triggers.length !== v.episodes.length ||
      !v.triggers.every((t, i) => obj(t) && keys(t, ['episodeId', 'personId', 'label', 'reason']) &&
        t.episodeId === (v.episodes as unknown[])[i] && owner(t.personId) && text(t.label, 80) && text(t.reason)) ||
      new Set(v.triggers.map((t) => t.personId)).size !== v.triggers.length ||
      !Array.isArray(v.facts) || v.facts.length > 41) return false;
  if (v.freshness === 'unavailable' && (v.priority !== 'none' || v.episodes.length || v.frameTimeMs !== null && !num(v.frameTimeMs))) return false;
  for (const f of v.facts) {
    if (!obj(f) || !keys(f, ['kind', 'owner', 'association', 'elapsedMs', 'description']) || !text(f.description) ||
        !(f.elapsedMs === null || num(f.elapsedMs))) return false;
    if (f.kind === 'posture') {
      if (!owner(f.owner) || f.association !== 'anonymous-person') return false;
    } else if (f.kind === 'tool-proximity' || f.kind === 'person-count') {
      if (f.owner !== null || f.elapsedMs !== null || f.association !== (f.kind === 'tool-proximity' ? 'image-only' : 'scene')) return false;
    } else return false;
  }
  if (v.priority !== 'check' && v.episodes.length) return false;
  const facts = v.facts;
  if (!v.triggers.every((t) => facts.some((f) => obj(f) && f.kind === 'posture' && f.owner === t.personId && num(f.elapsedMs) && Number(f.elapsedMs) >= 2000))) return false;
  if (v.priority === 'check' && (!v.reasons.length || !v.facts.some((f) => obj(f) && f.kind === 'posture' && num(f.elapsedMs) && Number(f.elapsedMs) >= 2000))) return false;
  if (v.zone !== null) {
    const z = v.zone;
    if (!obj(z) || !keys(z, ['id', 'name', 'dwellSec', 'status', 'occupants']) || !text(z.id, 80) || !text(z.name, 60) ||
        !num(z.dwellSec) || !Number.isInteger(z.dwellSec) || Number(z.dwellSec) < 1 || Number(z.dwellSec) > 60 ||
        !['off', 'watching', 'uncertain', 'stale'].includes(String(z.status)) || !Array.isArray(z.occupants) || z.occupants.length > 20 ||
        !z.occupants.every((p) => obj(p) && keys(p, ['personId', 'dwellMs', 'flagged']) && owner(p.personId) && num(p.dwellMs) && typeof p.flagged === 'boolean')) return false;
  }
  return true;
}

/** Persistence is intentionally narrower than the multi-person live decision. */
export function validIndividualCheck(v: unknown, source: unknown): v is ContextDecision {
  if (!validContextDecision(v)) return false;
  const trigger = v.triggers[0];
  return v.source === source && v.freshness === 'fresh' && v.priority === 'check' &&
    v.triggers.length === 1 && v.episodes.length === 1 && !!trigger &&
    v.facts.every((f) => f.kind !== 'posture' || f.owner === trigger.personId) &&
    v.reasons.length === 1 && v.reasons[0] === trigger.reason;
}
