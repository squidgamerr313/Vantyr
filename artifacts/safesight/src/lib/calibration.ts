export const CALIBRATION_LABELS = ['knife', 'scissors', 'remote', 'toothbrush', 'spoon', 'other-coco-object'] as const;
export type CalibrationLabel = typeof CALIBRATION_LABELS[number];
export const FEATURE_CONTRACT = 'tfjs-mobilenet-v1-1.0-pw13-mean1024-letterbox224-l2-v1';
export const FEATURE_SIZE = 1024;
export type CalibrationHead = { contract: string; labels: readonly string[]; weights: number[][]; bias: number[] };
export type PublicCalibration = { contract: string; labels: readonly string[]; centroids: number[][]; head: CalibrationHead; examplesPerClass: number[]; source: string };
export type CalibrationSample = { id: string; label: CalibrationLabel; split: 'train' | 'validation'; group: string; features: number[] };
export type CalibrationPrediction = { label: string; candidate: string; classScore: number; margin: number; scores: number[]; uncertain: boolean };
export type CalibrationEvaluation = { count: number; correct: number; accepted: number; acceptedCorrect: number; falseToolCalls: number; matrix: number[][]; labels: readonly string[] };

export function validFeatures(features: readonly number[]) {
  return features.length === FEATURE_SIZE && features.every(Number.isFinite) && Math.abs(Math.hypot(...features) - 1) < .02;
}
export function validateHead(head: CalibrationHead) {
  if (head.contract !== FEATURE_CONTRACT || head.labels.join('|') !== CALIBRATION_LABELS.join('|') ||
    head.weights.length !== 6 || head.bias.length !== 6 || !head.bias.every(Number.isFinite) ||
    head.weights.some(row => row.length !== FEATURE_SIZE || !row.every(n => Number.isFinite(n) && Math.abs(n) < 1000))) throw new Error('Classifier feature/label contract mismatch');
}
export function predictCalibration(head: CalibrationHead, features: readonly number[]): CalibrationPrediction {
  if (!validFeatures(features)) throw new Error('Invalid classifier features');
  const logits = head.weights.map((row, k) => row.reduce((sum, n, i) => sum + n * features[i]!, head.bias[k]!));
  const max = Math.max(...logits), exp = logits.map(n => Math.exp(n - max)), total = exp.reduce((a, b) => a + b, 0);
  const scores = exp.map(n => n / total), ranked = scores.map((score, i) => ({ score, i })).sort((a, b) => b.score - a.score);
  const score = ranked[0]!.score, margin = score - ranked[1]!.score, candidate = CALIBRATION_LABELS[ranked[0]!.i]!;
  const uncertain = score < .8 || margin < .3;
  return { label: uncertain ? 'uncertain' : candidate, candidate, classScore: score, margin, scores, uncertain };
}
export function evaluateCalibration(head: CalibrationHead, samples: readonly CalibrationSample[]): CalibrationEvaluation {
  const matrix = Array.from({ length: 6 }, () => Array(6).fill(0) as number[]);
  let correct = 0, accepted = 0, acceptedCorrect = 0, falseToolCalls = 0;
  for (const sample of samples) {
    const p = predictCalibration(head, sample.features), actual = CALIBRATION_LABELS.indexOf(sample.label);
    const index = CALIBRATION_LABELS.indexOf(p.candidate as CalibrationLabel);
    matrix[actual]![index]!++;
    if (index === actual) correct++;
    if (!p.uncertain) {
      accepted++; if (index === actual) acceptedCorrect++;
      if (actual > 1 && index <= 1) falseToolCalls++;
    }
  }
  return { count: samples.length, correct, accepted, acceptedCorrect, falseToolCalls, matrix, labels: CALIBRATION_LABELS };
}
export function calibrationApplyIssue(result: CalibrationEvaluation, baseline: CalibrationEvaluation) {
  if (result.count < 4 || result.correct / result.count < .75 || !result.accepted ||
    result.acceptedCorrect / result.accepted < .9 || result.accepted / result.count < .25)
    return 'Not applied: the small validation cohort needs at least 75% accuracy, 90% accepted accuracy and 25% coverage. Add varied validation views; this is not a field-safety qualification.';
  if (result.correct < baseline.correct || result.acceptedCorrect < baseline.acceptedCorrect || result.falseToolCalls > baseline.falseToolCalls)
    return 'Not applied: calibration regressed against the public baseline on the same validation views.';
  return null;
}
export function calibrationRequirements(samples: readonly CalibrationSample[]) {
  const trainedLabels = CALIBRATION_LABELS.filter(label => samples.some(s => s.label === label && s.split === 'train'));
  if (trainedLabels.length < 2) return 'Capture at least two camera classes, including an ordinary lookalike or other-object class.';
  if (!trainedLabels.some(label => !['knife', 'scissors'].includes(label))) return 'Include an ordinary lookalike or other-object class, not just tools.';
  for (const label of trainedLabels) {
    const training = samples.filter(s => s.label === label && s.split === 'train');
    const validation = samples.filter(s => s.label === label && s.split === 'validation');
    if (training.length < 3 || new Set(training.map(s => s.group)).size < 2 || validation.length < 2) return `${label}: need 3 training captures across 2 views and 2 validation captures in a separate view.`;
  }
  return null;
}
export function admitCalibrationSample(samples: readonly CalibrationSample[], next: CalibrationSample) {
  if (!CALIBRATION_LABELS.includes(next.label) || !['train', 'validation'].includes(next.split) || !next.group || !next.id || !validFeatures(next.features)) throw new Error('Invalid labelled sample');
  if (samples.length >= 120) throw new Error('120-sample limit reached. Clear the session to start a new cohort.');
  if (samples.some(s => s.group === next.group && s.split !== next.split)) throw new Error('Start a new view before switching between training and validation.');
  if (samples.some(s => s.split !== next.split && s.features.reduce((sum, n, i) => sum + n * next.features[i]!, 0) > .995)) throw new Error('Validation looks nearly identical to training. Change the view or setup before capturing.');
  return [...samples, next];
}

/** Actual cross-entropy gradient descent. Numeric features never leave the browser. */
export function trainCalibration(baseline: PublicCalibration, samples: readonly CalibrationSample[], progress?: (epoch: number) => void, epochs = 100): CalibrationHead {
  validateHead(baseline.head);
  if (baseline.contract !== FEATURE_CONTRACT || baseline.centroids.length !== 6 || baseline.centroids.some(c => !validFeatures(c))) throw new Error('Invalid public baseline');
  let checked: CalibrationSample[] = [];
  for (const sample of samples) checked = admitCalibrationSample(checked, sample);
  const training = samples.filter(s => s.split === 'train');
  const items = [...baseline.centroids.map((features, label) => ({ features, label, weight: 1 })),
    ...training.map(s => ({ features: s.features, label: CALIBRATION_LABELS.indexOf(s.label), weight: 1 }))];
  const counts = CALIBRATION_LABELS.map((_, label) => items.filter(s => s.label === label).length);
  const head = structuredClone(baseline.head);
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradient = Array.from({ length: 6 }, () => new Float64Array(FEATURE_SIZE)), bias = Array(6).fill(0) as number[];
    for (const item of items) {
      const p = predictCalibration(head, item.features);
      for (let k = 0; k < 6; k++) {
        const delta = (p.scores[k]! - Number(k === item.label)) / (6 * counts[item.label]!);
        bias[k]! += delta;
        for (let j = 0; j < FEATURE_SIZE; j++) gradient[k]![j]! += delta * item.features[j]!;
      }
    }
    for (let k = 0; k < 6; k++) {
      head.bias[k]! -= 3 * bias[k]!;
      for (let j = 0; j < FEATURE_SIZE; j++) head.weights[k]![j]! -= 3 * (gradient[k]![j]! + .001 * (head.weights[k]![j]! - baseline.head.weights[k]![j]!));
    }
    if ((epoch + 1) % 10 === 0) progress?.(epoch + 1);
  }
  validateHead(head); return head;
}
