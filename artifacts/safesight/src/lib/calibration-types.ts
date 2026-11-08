import type { RefObject } from 'react';
import type { CalibrationLabel, CalibrationEvaluation, CalibrationHead, CalibrationPrediction } from './calibration';
export type CalibrationPhase = 'off' | 'preparing' | 'collecting' | 'training' | 'stopping';
export type CalibrationController = {
  phase: CalibrationPhase; consent: boolean; setConsent: (value: boolean) => void;
  message: string; label: CalibrationLabel; setLabel: (label: CalibrationLabel) => void;
  split: 'train' | 'validation'; setSplit: (split: 'train' | 'validation') => void;
  counts: Record<string, { train: number; validation: number }>; groups: number; capturing: boolean;
  progress: number; evaluation: CalibrationEvaluation | null; prediction: CalibrationPrediction | null;
  baselineEvaluation: CalibrationEvaluation | null;
  publicCount: number; applied: boolean; draft: CalibrationHead | null; requirement: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  start: () => Promise<void>; stop: () => Promise<void>; clear: () => Promise<void>;
  capture: () => Promise<void>; newView: () => void; train: () => void;
  test: () => Promise<void>; apply: () => Promise<void>; forget: () => void;
};
