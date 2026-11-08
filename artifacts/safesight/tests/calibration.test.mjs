import test from 'node:test';
import assert from 'node:assert/strict';
import { CALIBRATION_LABELS, FEATURE_CONTRACT, FEATURE_SIZE, admitCalibrationSample, calibrationApplyIssue,
  calibrationRequirements, evaluateCalibration, predictCalibration, trainCalibration, validateHead } from '../src/lib/calibration.ts';
const features = (index, noise = 0) => {
  const row = Array(FEATURE_SIZE).fill(0); row[index] = Math.sqrt(1 - noise * noise); row[20 + index] = noise; return row;
};
const base = () => ({
  contract: FEATURE_CONTRACT, labels: CALIBRATION_LABELS, centroids: CALIBRATION_LABELS.map((_, i) => features(i)), examplesPerClass: Array(6).fill(16), source: 'synthetic contract fixture, not accuracy evidence',
  head: { contract: FEATURE_CONTRACT, labels: CALIBRATION_LABELS, weights: CALIBRATION_LABELS.map(() => Array(FEATURE_SIZE).fill(0)), bias: Array(6).fill(0) },
});
const sample = (label, group, split = 'train', noise = 0) => ({ id: `${label}-${group}-${split}`, label, group, split, features: features(CALIBRATION_LABELS.indexOf(label), noise) });
test('feature/label contract mismatches and malformed samples fail closed', () => {
  assert.throws(() => validateHead({ ...base().head, contract: 'wrong-model' }), /contract/);
  assert.throws(() => validateHead({ ...base().head, labels: [...CALIBRATION_LABELS].reverse() }), /contract/);
  assert.throws(() => admitCalibrationSample([], { ...sample('scissors','a'), features: [1] }), /sample/);
  assert.throws(() => admitCalibrationSample([], { ...sample('scissors','a'), split: 'test' }), /sample/);
});
test('train and validation cannot share a view or nearly identical features', () => {
  const training = [sample('scissors', 'a')];
  assert.throws(() => admitCalibrationSample(training, sample('remote','a','validation')), /new view/);
  assert.throws(() => admitCalibrationSample(training, sample('scissors','b','validation')), /nearly identical/);
  assert.equal(admitCalibrationSample(training, sample('scissors','b','validation',.2)).length, 2);
});
test('requires multiple classes, ordinary controls and distinct training views', () => {
  assert.match(calibrationRequirements([sample('scissors','a')]), /two camera classes/);
  assert.match(calibrationRequirements([sample('knife','a'),sample('scissors','b')]), /ordinary/);
  assert.match(calibrationRequirements([sample('scissors','a'),sample('remote','a')]), /3 training captures/);
});
test('gradient updates learn classes; held-out snapshots do not enter training', () => {
  const baseline = base();
  const training = [sample('scissors','a'),sample('remote','a')];
  const validation = [sample('scissors','v','validation',.2),sample('remote','v','validation',.2)];
  const head = trainCalibration(baseline, [...training, ...validation]);
  assert.notDeepEqual(head.weights, baseline.head.weights);
  assert.deepEqual(head, trainCalibration(baseline, training));
  const metric = evaluateCalibration(head, validation);
  assert.equal(metric.correct, 2); assert.equal(metric.falseToolCalls, 0);
  assert.equal(predictCalibration(head, validation[0].features).candidate, 'scissors');
});
test('low-score crops abstain, not safe or harmless', () => {
  const result = predictCalibration(base().head, features(1));
  assert.equal(result.label, 'uncertain'); assert.equal(result.uncertain, true);
  assert.ok(Math.abs(result.classScore - 1/6) < 1e-8);
});
test('false tool calls and complete denominators are retained', () => {
  const head = base().head; head.bias[1] = 10;
  const metric = evaluateCalibration(head,[sample('remote','v','validation'),sample('scissors','v','validation')]);
  assert.equal(metric.count, 2); assert.equal(metric.correct,1); assert.equal(metric.accepted,2); assert.equal(metric.falseToolCalls,1);
  assert.equal(metric.matrix[2][1],1);
});
test('apply rejects regression, insufficient accuracy, accepted accuracy and coverage', () => {
  const okay = { count: 8, correct: 8, accepted: 4, acceptedCorrect: 4, falseToolCalls: 0 };
  assert.equal(calibrationApplyIssue(okay, okay), null);
  assert.match(calibrationApplyIssue({...okay, correct:5},okay), /75%/);
  assert.match(calibrationApplyIssue({...okay, accepted:0},okay), /coverage/);
  assert.match(calibrationApplyIssue({...okay, acceptedCorrect:3},okay), /90%/);
  assert.match(calibrationApplyIssue({...okay, falseToolCalls:1},okay), /regressed/);
});
test('worker-side math also rejects train/validation leakage', () => {
  assert.throws(() => trainCalibration(base(), [sample('scissors','a'),sample('scissors','a','validation')]), /new view/);
});
