import { calibrationCrop, createCalibrationEncoder } from '../src/lib/calibration-encoder';
import { CALIBRATION_LABELS, FEATURE_CONTRACT, FEATURE_SIZE, trainCalibration, type CalibrationLabel, type CalibrationSample, type PublicCalibration } from '../src/lib/calibration';
export async function buildPublicPrior(fixtures: { file: string; label: CalibrationLabel; box: number[]; image_sha256: string }[]) {
  const controller = new AbortController(), encoder = await createCalibrationEncoder(controller.signal);
  const samples: CalibrationSample[] = [];
  try {
    for (const [index, fixture] of fixtures.entries()) {
      const image = new Image(); image.src = `/@fs/path/to/vantyr/generated-artifacts/tool-training/${fixture.file}`; await image.decode();
      const canvas = calibrationCrop(image, image.naturalWidth, image.naturalHeight, fixture.box);
      try { samples.push({ id: `public-${index}`, label: fixture.label, split: 'train', group: fixture.image_sha256, features: await encoder.encode(canvas) }); }
      finally { canvas.width = canvas.height = 0; }
    }
    const centroids = CALIBRATION_LABELS.map(label => {
      const rows = samples.filter(s => s.label === label);
      const mean = Array.from({ length: FEATURE_SIZE }, (_, j) => rows.reduce((sum, r) => sum + r.features[j]!, 0) / rows.length);
      const norm = Math.hypot(...mean); return mean.map(n => n / norm);
    });
    const baseline: PublicCalibration = { contract: FEATURE_CONTRACT, labels: CALIBRATION_LABELS, centroids,
      head: { contract: FEATURE_CONTRACT, labels: CALIBRATION_LABELS, weights: Array.from({ length: 6 }, () => Array(FEATURE_SIZE).fill(0)), bias: Array(6).fill(0) },
      examplesPerClass: CALIBRATION_LABELS.map(label => samples.filter(s => s.label === label).length),
      source: '96 COCO train2017 crops with recorded CC BY/BY-SA licences; frozen development-only subset. Not a field benchmark or a previously rejected PyTorch checkpoint.' };
    baseline.head = trainCalibration(baseline, samples, undefined, 200);
    baseline.centroids = baseline.centroids.map(row => row.map(n => +n.toFixed(7)));
    baseline.head.weights = baseline.head.weights.map(row => row.map(n => +n.toFixed(7)));
    return baseline;
  } finally { controller.abort(); await encoder.dispose(); }
}
