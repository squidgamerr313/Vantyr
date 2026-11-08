import { trainCalibration, type PublicCalibration, type CalibrationSample } from './calibration.ts';
self.onmessage = (event: MessageEvent<{ baseline: PublicCalibration; samples: CalibrationSample[] }>) => {
  try {
    const head = trainCalibration(event.data.baseline, event.data.samples, epoch => self.postMessage({ type: 'progress', epoch }));
    self.postMessage({ type: 'trained', head }); self.close();
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Training failed' }); self.close(); }
};
