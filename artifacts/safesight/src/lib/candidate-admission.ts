/** Admission is release-owned, not a user preference or a model-returned flag.
 * No research adapter is imported by the live runtime. Missing gates fail closed. */
export const CANDIDATES = [
  { id: 'fall-transformer', capability: 'Fall / person-down', report: 'safesight-fall-evaluation.md',
    reason: 'Training/deployment landmark, coordinate and elapsed-time contracts do not agree.' },
  { id: 'nfd', capability: 'Fall / person-down', report: 'safesight-fall-validation.md',
    reason: 'Rejected real-video evaluation: all eight event windows missed; sustained-down truth and browser qualification are missing.' },
  { id: 'st-gcn', capability: 'Fall / person-down', report: 'fall-candidate-audit.json',
    reason: 'Weights/code permissions, lineage and timestamp-preserving input contract are unresolved.' },
  { id: 'autoencoder', capability: 'Fall / person-down', report: 'fall-candidate-audit.json',
    reason: 'No qualified released weights; reconstruction error is not fall/down/recovery classification.' },
  { id: 'mc3', capability: 'Walking / running', report: 'safesight-activity-evaluation.md',
    reason: 'Prior action evaluation rejected; clip-level labels do not supply fresh person ownership.' },
  { id: 'slowfast', capability: 'Walking / running', report: 'locomotion-v2-results.json',
    reason: 'Native taxonomy, temporal/person contract and target-browser measurements have not passed.' },
  { id: 'interaction', capability: 'Person-to-person interaction', report: 'interaction-evaluation-results.json',
    reason: 'No qualifying contact/actor/recipient truth or compatible person-pair input. Object push is not interpersonal pushing.' },
  { id: 'tracking-alternatives', capability: 'Enhanced tracking / scene motion', report: 'tracking-evaluation-results.json',
    reason: 'Upscaling did not improve overall evidence; scene gating withheld most real-camera evidence. Retain baseline tracking.' },
  { id: 'temporal-tools', capability: 'Temporal knife / scissors', report: 'sharp-object-evaluation-results.json',
    reason: 'Independent temporal visibility and person/tool association truth are insufficient; no target-browser qualification.' },
] as const;

export const ADMISSION_GATES = ['evaluation', 'nativeContract', 'personAssociation', 'browserOperators', 'resourceBudget'] as const;
export type AdmissionGate = typeof ADMISSION_GATES[number];
export function candidateAdmission(id: string) {
  const candidate = CANDIDATES.find((c) => c.id === id);
  // A completed report, numeric result, or caller-supplied gate cannot activate a candidate.
  return { enabled: false as const, candidate: candidate?.id ?? null,
    reason: candidate?.reason ?? 'Unknown candidate. No release-qualified adapter exists.',
    gates: Object.fromEntries(ADMISSION_GATES.map((gate) => [gate, 'not-qualified'])) as Record<AdmissionGate, 'not-qualified'> };
}
