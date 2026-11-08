/**
 * Frozen pre-tracking heuristic, retained only for like-for-like CPU benchmarks.
 * Never imported by the application. Includes the original evidence allocations.
 */
export function createLegacyRiskAssessor() {
  let horizontalSince = null, lastAssessment = 0;
  const visible = (p) => !!p && (p.visibility ?? 0) > .6;
  return (result, width, height, now) => {
    if (now - lastAssessment > 2500 || now < lastAssessment) horizontalSince = null;
    lastAssessment = now;
    const evidence = [];
    let score = 0;
    const objects = result.detections.filter((d) => d.confidence >= .55);
    const people = objects.filter((d) => d.label === 'person');
    const sharp = objects.filter((d) => d.label === 'knife' || d.label === 'scissors');
    for (const person of people) for (const item of sharp) {
      const pc = [person.box[0] + person.box[2] / 2, person.box[1] + person.box[3] / 2];
      const ic = [item.box[0] + item.box[2] / 2, item.box[1] + item.box[3] / 2];
      if (Math.hypot((pc[0] - ic[0]) / width, (pc[1] - ic[1]) / height) < .3) {
        score = Math.max(score, 48);
        evidence.push(`A ${item.label} and person appear close in the image. Depth and intent are unknown; verify handling.`);
      }
    }
    if (people.length >= 4) {
      score = Math.max(score, 35);
      evidence.push(`${people.length} people detected in frame. Check access routes; this alone does not establish overcrowding.`);
    }
    const horizontal = result.landmarks.some((pose) => {
      const [ls, rs, lh, rh] = [pose[11], pose[12], pose[23], pose[24]];
      if (![ls, rs, lh, rh].every(visible)) return false;
      const dx = Math.abs((ls.x + rs.x - lh.x - rh.x) / 2) * width;
      const dy = Math.abs((ls.y + rs.y - lh.y - rh.y) / 2) * height;
      return dx > dy * 1.5 && dx > width * .08;
    });
    if (horizontal) {
      horizontalSince ??= now;
      const duration = now - horizontalSince;
      if (duration >= 2000) {
        score = Math.max(score, duration >= 5000 ? 72 : 52);
        evidence.push(`A near-horizontal torso has persisted for ${(duration / 1000).toFixed(1)} seconds. Could be normal activity; visually check the person. This is not a confirmed fall.`);
      }
    } else horizontalSince = null;
    if (!evidence.length) evidence.push('No configured risk heuristic triggered. This does not mean the environment is safe.');
    return { score, level: score >= 70 ? 'high' : score >= 30 ? 'moderate' : 'low', evidence: [...new Set(evidence)] };
  };
}
