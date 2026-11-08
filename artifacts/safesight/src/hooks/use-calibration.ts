import { useEffect, useRef, useState } from 'react';
import { admitCalibrationSample, calibrationApplyIssue, calibrationRequirements, evaluateCalibration, predictCalibration, validateHead,
  CALIBRATION_LABELS, type CalibrationHead, type CalibrationLabel, type CalibrationSample, type PublicCalibration, type CalibrationEvaluation, type CalibrationPrediction } from '@/lib/calibration';
import { calibrationCrop, createCalibrationEncoder } from '@/lib/calibration-encoder';
import type { CalibrationController, CalibrationPhase } from '@/lib/calibration-types';

type Encoder = Awaited<ReturnType<typeof createCalibrationEncoder>>;
type Session = { abort: AbortController; preparing: Promise<Encoder> | null; encoder: Encoder | null; baseline: PublicCalibration | null;
  stream: MediaStream | null; worker: Worker | null; samples: CalibrationSample[]; group: string; views: number; capturing: boolean };

export function useCalibration(options: { disabled: boolean; applied: boolean; onActive: (active: boolean) => void; onApply: (head: CalibrationHead | null) => void }): CalibrationController {
  const callbacks = useRef(options); callbacks.current = options;
  const mounted = useRef(true), session = useRef<Session | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<CalibrationPhase>('off'), phaseRef = useRef<CalibrationPhase>('off');
  const changePhase = (p: CalibrationPhase) => { phaseRef.current = p; if (mounted.current) setPhase(p); };
  const [consent, setConsent] = useState(false), [label, setLabel] = useState<CalibrationLabel>('scissors');
  const [split, setSplit] = useState<'train' | 'validation'>('train');
  const [message, setMessage] = useState('Optional, local-only object calibration. No camera starts until you consent and press Start.');
  const [capturing, setCapturing] = useState(false), [progress, setProgress] = useState(0), [, refresh] = useState(0);
  const [draft, setDraft] = useState<CalibrationHead | null>(null);
  const [evaluation, setEvaluation] = useState<CalibrationEvaluation | null>(null);
  const [baselineEvaluation, setBaselineEvaluation] = useState<CalibrationEvaluation | null>(null);
  const [prediction, setPrediction] = useState<CalibrationPrediction | null>(null), [publicCount, setPublicCount] = useState(0);
  const current = (s: Session) => mounted.current && session.current === s && !s.abort.signal.aborted;

  async function stop() {
    const s = session.current;
    if (!s) return;
    session.current = null; changePhase('stopping');
    s.abort.abort();
    if (s.worker) { s.worker.onmessage = null; s.worker.onerror = null; s.worker.onmessageerror = null; s.worker.terminate(); s.worker = null; }
    s.stream?.getTracks().forEach(track => track.stop());
    const video = videoRef.current;
    if (video?.srcObject === s.stream) { video.pause(); video.srcObject = null; }
    for (const sample of s.samples) sample.features.fill(0);
    s.samples.length = 0;
    if (mounted.current) {
      setDraft(null); setEvaluation(null); setBaselineEvaluation(null); setPrediction(null); setCapturing(false); setProgress(0); setConsent(false); refresh(n => n + 1);
    }
    try { const encoder = s.encoder ?? await s.preparing?.catch(() => null); await encoder?.dispose(); }
    finally {
      if (!session.current) {
        callbacks.current.onActive(false); changePhase('off');
        if (mounted.current) setMessage('Stopped. Private sample features, draft and camera stream cleared. Applied weights remain only for this tab until Forget or reload.');
      }
    }
  }
  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden) void stopRef.current(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', hidden); void stopRef.current(); };
  }, []);

  async function start() {
    if (!consent || callbacks.current.disabled || phaseRef.current !== 'off' || document.hidden) return;
    const s: Session = { abort: new AbortController(), preparing: null, encoder: null, baseline: null, stream: null, worker: null, samples: [], group: crypto.randomUUID(), views: 1, capturing: false };
    session.current = s; callbacks.current.onActive(true); callbacks.current.onApply(null); changePhase('preparing');
    setMessage('Loading the public object baseline and local feature encoder. Camera has not started yet.');
    try {
      const baseline = (await import('@/data/calibration-public.json')).default as PublicCalibration;
      validateHead(baseline.head); s.baseline = baseline;
      if (!current(s)) return;
      s.preparing = createCalibrationEncoder(s.abort.signal); s.encoder = await s.preparing;
      if (!current(s)) { await s.encoder.dispose(); return; }
      setPublicCount(baseline.examplesPerClass.reduce((a, b) => a + b, 0));
      setMessage('Waiting for camera permission. Microphone is never requested.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
      if (!current(s)) { stream.getTracks().forEach(track => track.stop()); return; }
      s.stream = stream;
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (current(s)) void stopRef.current(); }, { once: true }));
      const video = videoRef.current; if (!video) throw new Error('Calibration preview is unavailable');
      video.srcObject = stream; await video.play();
      if (!current(s)) return;
      changePhase('collecting'); setMessage('Place one safe labelled object in the centre guide. Capture varied training views, then separate validation views. No pictures are saved.');
    } catch (error) {
      if (current(s)) {
        const text = error instanceof Error ? error.message : String(error);
        await stop(); if (mounted.current && !session.current) setMessage(`Calibration unavailable: ${text}. No predictions are applied.`);
      }
    }
  }
  async function readCrop(s: Session) {
    const video = videoRef.current;
    if (!video || video.srcObject !== s.stream || video.readyState < 2 || !video.videoWidth || !s.stream?.getVideoTracks().every(t => t.readyState === 'live')) throw new Error('Waiting for a live decoded calibration frame');
    const time = video.currentTime, source = video.srcObject;
    const canvas = calibrationCrop(video, video.videoWidth, video.videoHeight);
    try {
      const features = await s.encoder!.encode(canvas);
      if (!current(s) || video.srcObject !== source || video.currentTime < time || !s.stream.getVideoTracks().every(t => t.readyState === 'live')) throw new Error('Calibration source changed; sample discarded');
      return features;
    } finally { canvas.width = canvas.height = 0; }
  }
  async function capture() {
    const s = session.current;
    if (!s || !current(s) || phaseRef.current !== 'collecting' || s.capturing) return;
    s.capturing = true; setCapturing(true);
    const sampleLabel = label, sampleSplit = split, group = s.group;
    try {
      const features = await readCrop(s); if (!current(s)) return;
      s.samples = admitCalibrationSample(s.samples, { id: crypto.randomUUID(), label: sampleLabel, split: sampleSplit, group, features });
      setDraft(null); setEvaluation(null); setBaselineEvaluation(null); setPrediction(null); refresh(n => n + 1);
      setMessage(`Captured ${sampleLabel} for ${sampleSplit}. Only a numeric feature vector is retained in browser memory.`);
    } catch (error) { if (current(s)) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { s.capturing = false; if (current(s)) setCapturing(false); }
  }
  function newView() {
    const s = session.current;
    if (!s || phaseRef.current !== 'collecting' || s.capturing) return;
    s.group = crypto.randomUUID(); s.views++; refresh(n => n + 1);
    setMessage('New view group. Actually change orientation, distance or background before capturing. Group names alone do not establish independent footage.');
  }
  function train() {
    const s = session.current;
    if (!s || !current(s) || !s.baseline || phaseRef.current !== 'collecting' || s.capturing) return;
    const issue = calibrationRequirements(s.samples); if (issue) { setMessage(issue); return; }
    const validation = s.samples.filter(sample => sample.split === 'validation');
    setBaselineEvaluation(evaluateCalibration(s.baseline.head, validation)); setEvaluation(null); setDraft(null); setPrediction(null); setProgress(0);
    try {
      const worker = new Worker(new URL('../lib/calibration.worker.ts', import.meta.url), { type: 'module' }); s.worker = worker;
      changePhase('training'); setMessage('Training a six-class linear head with cross-entropy gradient descent, public class anchors and your training features. Validation is excluded.');
      const fail = (text: string) => {
        worker.terminate(); s.worker = null;
        if (current(s)) { changePhase('collecting'); setMessage(`Training failed: ${text}`); }
      };
      worker.onerror = event => fail(event.message || 'Local worker unavailable');
      worker.onmessageerror = () => fail('Invalid worker response');
      worker.onmessage = event => {
        if (!current(s) || s.worker !== worker) return;
        if (event.data.type === 'progress') { setProgress(event.data.epoch / 100); return; }
        if (event.data.type === 'error') { fail(event.data.message); return; }
        if (event.data.type !== 'trained') return;
        try {
          const head = event.data.head as CalibrationHead; validateHead(head);
          setDraft(head); setEvaluation(evaluateCalibration(head, validation)); setProgress(1);
          worker.terminate(); s.worker = null; changePhase('collecting');
          setMessage('Training complete. Compare the public baseline and trained head on the same validation snapshots. These are not independent field results.');
        } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
      };
      worker.postMessage({ baseline: s.baseline, samples: s.samples });
    } catch (error) { s.worker?.terminate(); s.worker = null; changePhase('collecting'); setMessage(`Training unavailable: ${String(error)}`); }
  }
  async function test() {
    const s = session.current;
    if (!s || !current(s) || phaseRef.current !== 'collecting' || s.capturing || !s.baseline) return;
    s.capturing = true; setCapturing(true);
    try {
      const features = await readCrop(s);
      if (current(s)) {
        setPrediction(predictCalibration(draft ?? s.baseline.head, features));
        setMessage(`${draft ? 'Camera-trained head' : 'Public baseline'}: current centre crop only. Candidate scores are not calibrated danger probabilities. No action or history event is created.`);
      }
    } catch (error) { if (current(s)) setMessage(String(error)); }
    finally { s.capturing = false; if (current(s)) setCapturing(false); }
  }
  async function apply() {
    if (!draft || !evaluation || !baselineEvaluation || phaseRef.current !== 'collecting' || session.current?.capturing) return;
    const issue = calibrationApplyIssue(evaluation, baselineEvaluation); if (issue) { setMessage(issue); return; }
    callbacks.current.onApply(structuredClone(draft)); await stop();
  }
  function forget() { callbacks.current.onApply(null); setMessage('Applied classifier forgotten. Live base-detector behaviour is unchanged.'); }
  async function clear() { await stop(); forget(); }
  const samples = session.current?.samples ?? [];
  const counts = Object.fromEntries(CALIBRATION_LABELS.map(l => [l, { train: samples.filter(s => s.label === l && s.split === 'train').length, validation: samples.filter(s => s.label === l && s.split === 'validation').length }]));
  return { phase, consent, setConsent, label, setLabel, split, setSplit, message, counts, groups: session.current?.views ?? 0,
    capturing, progress, evaluation, baselineEvaluation, prediction, publicCount, applied: options.applied, draft, videoRef,
    requirement: calibrationRequirements(samples), start, stop, clear, capture, newView, train, test, apply, forget };
}
