import type { ContextDecision } from './context-decision.ts';

/** A reviewable record concerns exactly one new person episode. Scene facts
 * remain context; another person's posture/reasons must never become its subject. */
export function individualCheckDecisions(decision: ContextDecision): ContextDecision[] {
  if (decision.freshness !== 'fresh' || decision.priority !== 'check') return [];
  return decision.triggers.map((trigger) => ({
    ...decision,
    episodes: [trigger.episodeId],
    triggers: [{ ...trigger }],
    facts: [
      ...decision.facts.filter((f) => f.kind === 'posture' && f.owner === trigger.personId),
      ...decision.facts.filter((f) => f.kind !== 'posture'),
    ],
    reasons: [trigger.reason],
    checks: [`Check whether ${trigger.label} needs assistance. This record concerns only this anonymous person episode; record the human outcome separately.`],
  }));
}
