import { CANDIDATES, candidateAdmission } from '@/lib/candidate-admission';

export function CandidateAvailability() {
  return <details className="mt-4 text-xs text-muted-foreground" data-testid="candidate-availability">
    <summary className="cursor-pointer py-2 font-medium">Detection capabilities: new candidates unavailable</summary>
    <p className="my-2">No candidate passed every evaluation, native input/label, person association, browser-operator and resource gate. No new models are loaded. Fall, visibly sustained person-down and observed recovery are not inferred from posture.</p>
    <ul className="space-y-2">{CANDIDATES.map((c) => <li key={c.id}>
      <strong>{c.capability} ({c.id}): unavailable.</strong> {candidateAdmission(c.id).reason}
    </li>)}</ul>
  </details>;
}
