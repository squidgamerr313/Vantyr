import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'wouter';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { Play, Square, Camera, SwitchCamera, Volume2, VolumeX, Sparkles, AlertTriangle, Loader2, ScanEye, ListTree, Activity, RotateCcw, X, Clapperboard, Check, ChevronRight, Cpu } from 'lucide-react';
import { useAnalyzeScene, analyzeScene } from '@workspace/api-client-react';
import type { SceneAssessment } from '@workspace/api-client-react';
import { AppShell, Panel, LevelBadge, SourceBadge } from '@/components/shell';
import './dashboard.css';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useCamera } from '@/hooks/use-camera';
import { useMonitoringHealth } from '@/hooks/use-monitoring-health';
import { MonitoringStatus } from '@/components/monitoring-status';
import { beginMonitoredInference } from '@/lib/monitoring-inference';
import { useZoneSession } from '@/hooks/use-zone-session';
import { ZoneEditor } from '@/components/zone-editor';
import { ZoneOverlay } from '@/components/zone-overlay';
import { ZoneWorkflow } from '@/components/zone-workflow';
import { ZoneSessionSummary } from '@/components/zone-session-summary';
import { simulateDemoFrame, type ZoneScenario } from '@/lib/zone-demo';
import { createVisionEngine, type VisionResult, type VisionDiagnostics } from '@/lib/vision';
import { assessRisk, resetRisk, type RiskAssessment } from '@/lib/risk';
import { motionEvidence } from '@/lib/motion-evidence';
import { TrackingEvidence } from '@/components/tracking-evidence';
import { ObservationAssessment } from '@/components/observation-assessment';
import { presentCurrentObservation } from '@/lib/observation-presentation';
import { drawOverlay, DEMO_W, DEMO_H } from '@/lib/overlay';
import { addEvent, setPrefs, usePrefs, getPrefs, type RiskLevel, type Source, type SafetyEvent, useEvents } from '@/lib/store';
import { waitFor, waitForDelay } from '@/lib/async';
import { createSessionClock } from '@/lib/session-clock';
import { createRequestGate } from '@/lib/request-gate';
import { createFrameWatchdog } from '@/lib/frame-watchdog';
import { armAudio, playAlert } from '@/lib/audio';
import { cn } from '@/lib/utils';
import { StateIllustration } from '@/components/illustrations';
import { initialMonitorMode } from '@/lib/monitor-entry';
import { EVIDENCE_MAX_AGE_MS } from '@/lib/monitoring-health';
import { createContextDecisionLayer } from '@/lib/context-decision';
import { CandidateAvailability } from '@/components/candidate-availability';
import { CheckUnsaved } from '@/components/check-unsaved';
import { getPendingChecks, saveCheck } from '@/lib/check-outbox';
import { individualCheckDecisions } from '@/lib/context-check-records';
import { SpeechReviewPanel } from '@/components/speech-review';
import { ResponseControls } from '@/components/response-controls';
import { useResponses } from '@/hooks/use-responses';
import { cameraResponseReadiness } from '@/lib/responses';
import { createToolMotionReviewer, type ObjectProfile, type ToolMotionEvidence } from '@/lib/tool-motion';
import { ToolMotionPanel } from '@/components/tool-motion-panel';
import { CalibrationPanel } from '@/components/calibration-panel';
import { useCalibration } from '@/hooks/use-calibration';
import type { CalibrationHead } from '@/lib/calibration';

type Mode = 'demo' | 'live' | 'off';
type Risk = RiskAssessment;
type Point = { t: number; score: number };
type Mark = { ts: number; level: RiskLevel | 'uncertain'; score: number; note: string; source: Source };
type PerformanceSample = {
  stages: VisionResult['stages']; trackingMs: number | null; overlayMs: number | null;
  ageMs: number; admitted: boolean; rejected: number; skipped: number; decodeMs: number | null;
  model: VisionDiagnostics | undefined;
};

const LEVEL_COLOR: Record<RiskLevel | 'uncertain', string> = { low: 'hsl(158 70% 26%)', moderate: 'hsl(30 92% 38%)', high: 'hsl(352 72% 46%)', uncertain: 'hsl(228 12% 40%)' };

export default function Dashboard() {
  const prefs = usePrefs();
  const cam = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [entryMode] = useState(() => initialMonitorMode(window.location.search));
  const [mode, setMode] = useState<Mode>(entryMode);
  const [engineStatus, setEngineStatus] = useState<string>('');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [loadingEngine, setLoadingEngine] = useState(false);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [performanceSample, setPerformanceSample] = useState<PerformanceSample | null>(null);
  const [frameDims, setFrameDims] = useState<{ w: number; h: number } | null>(null);
  const [series, setSeries] = useState<Point[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [snapOpen, setSnapOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const responses = useResponses();
  const [objectProfile, setObjectProfile] = useState<ObjectProfile>('balanced');
  const [calibrationHead, setCalibrationHead] = useState<CalibrationHead | null>(null);
  const [calibrationActive, setCalibrationActive] = useState(false);
  const calibrationActiveRef = useRef(false);
  const calibration = useCalibration({
    disabled: mode !== 'off' || loadingEngine,
    applied: calibrationHead !== null,
    onActive(active) { calibrationActiveRef.current = active; setCalibrationActive(active); },
    onApply(head) {
      // Forgetting must also dispose any live engine retaining the old weights.
      if (sourceRef.current === 'live') stopAll();
      setCalibrationHead(head);
    },
  });
  const [toolMotion, setToolMotion] = useState<ToolMotionEvidence | null>(null);
  const toolReviewer = useRef(createToolMotionReviewer());
  const responseDetails = useRef<HTMLDetailsElement>(null);
  const respond = responses.execute;
  const zones = useZoneSession(setAudioError, respond);
  const zoneProcess = zones.process, zoneStart = zones.start, zoneStop = zones.stop;

  const sessionRef = useRef(0);
  const sourceRef = useRef<Mode>(entryMode);
  const modelAbort = useRef<AbortController | null>(null);
  const engineRef = useRef<{ dispose(): void } | null>(null);
  const lastLevel = useRef<RiskLevel | 'uncertain' | null>(null);
  const decisions = useRef(createContextDecisionLayer());
  const decisionSession = useRef(crypto.randomUUID());
  const clock = useRef(createSessionClock(performance.now()));
  const { health, monitor, sampleVideo, frameDiagnostics, admitFrame } = useMonitoringHealth(cam.videoRef, () => {
    resetRisk(); decisions.current.reset(); lastLevel.current = null;
    setRisk(null); setResult(null); setFps(null);
    zones.invalidate();
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  });
  useLayoutEffect(() => {
    if (entryMode === 'off') {
      zoneStop();
      monitor.enter('stopped', performance.now(), 'Camera is not running. Start it when you are ready; permission is requested only after your action.');
    }
  }, [entryMode, monitor, zoneStop]);

  const resetSession = useCallback(() => {
    resetRisk();
    decisions.current.reset();
    decisionSession.current = crypto.randomUUID();
    lastLevel.current = null;
    clock.current.reset(performance.now());
    setSnapOpen(false); setSnapshot(null);
    setSnapshotError(null);
    setRisk(null); setResult(null); setFps(null); setFrameDims(null); setSeries([]); setMarks([]);
    toolReviewer.current.reset(); setToolMotion(null);
    setPerformanceSample(null);
  }, []);

  const handleFrame = useCallback((r: VisionResult, w: number, h: number, source: Source) => {
    if (sourceRef.current !== source) return;
    const p = getPrefs();
    const now = performance.now();
    const ctx = canvasRef.current?.getContext('2d');
    const filtered: VisionResult = { ...r, detections: r.detections.filter((d) => d.confidence >= p.minConfidence) };
    let trackingMs = 0;
    const assessed = assessRisk(filtered, w, h, now, { source, onTrackingTiming: ms => { trackingMs = ms; } });
    const zone = zoneProcess(filtered, assessed.tracking, w, h, source, now);
    const decision = decisions.current.decide({ result: filtered, tracking: assessed.tracking, width: w, height: h,
      now, source, sessionId: decisionSession.current, zone,
      blockedReason: getPendingChecks().length + assessed.tracking.persons.length > 50
        ? 'Human-check logging is paused: insufficient retry capacity for the visible people. Save pending observations to resume; temporal evidence is withheld.' : undefined });
    const a = { ...assessed, decision };
    const tools = source === 'live' && r.frameTimeMs !== undefined
      ? toolReviewer.current.update(r.detections, w, h, r.frameTimeMs, now, decisionSession.current)
      : null;
    const overlayStart = performance.now();
    if (ctx) drawOverlay(ctx, filtered, w, h, { boxes: p.showBoxes, pose: p.showPose, minConf: p.minConfidence, simulated: source === 'demo', persons: a.tracking.persons });
    const overlayMs = performance.now() - overlayStart;
    const measuredFps = source === 'live' ? clock.current.frame(now) : null;

    const shownLevel = decision.priority === 'check' ? 'moderate' : 'uncertain';
    if (shownLevel !== lastLevel.current) {
      lastLevel.current = shownLevel;
      const mark: Mark = { ts: Date.now(), level: shownLevel, score: a.score, note: decision.reasons[0] ?? 'No human-check rule triggered', source };
      setMarks((m) => [mark, ...m].slice(0, 40));
    }
    // No alert is driven by a legacy rule score. One record per owned episode,
    // not a recurring cooldown timer. High-only logging withholds descriptive checks.
    let responseHandled = false;
    if (source === 'live') for (const trigger of decision.triggers) {
      responseHandled = respond({ id: `posture:${trigger.episodeId}`, kind: 'camera-posture', at: Date.now(), source: 'live' }) || responseHandled;
    }
    if (decision.episodes.length && p.logThreshold !== 'high') {
      for (const individual of individualCheckDecisions(decision)) {
        const personId = individual.triggers[0]!.personId;
        saveCheck({ id: crypto.randomUUID(), ts: Date.now(), source, kind: 'risk', level: 'uncertain', score: null,
          evidence: [...individual.facts.map((f) => f.description), ...individual.reasons], detections: filtered.detections.length,
          decision: individual, review: { status: 'open', actions: [] },
          motion: motionEvidence({ ...a.tracking, persons: a.tracking.persons.filter((p) => p.id === personId) },
            source === 'demo' ? 'simulation' : r.frameTimeMs === undefined ? 'processing-time' : 'decoded-video') });
      }
      if (p.audioAlerts && !responseHandled) {
        window.dispatchEvent(new Event('vantyr:response-audio'));
        void playAlert().then(setAudioError);
      }
    }
    if (clock.current.pointDue(now)) {
      setSeries((s) => [...s, { t: clock.current.seconds(now), score: a.score }].slice(-120));
    }
    if (clock.current.uiDue(now)) {
      setRisk(a); setResult(filtered);
      setToolMotion(tools);
      setFrameDims((old) => old?.w === w && old.h === h ? old : { w, h });
      setFps(measuredFps);
    }
    return { trackingMs, overlayMs };
  }, [zoneProcess, respond]);

  const teardown = useCallback((publish = true) => {
    // Invalidate pending inference ownership before releasing camera/model resources.
    if (publish) monitor.enter('stopped', performance.now());
    sessionRef.current++;
    sourceRef.current = 'off';
    modelAbort.current?.abort(); modelAbort.current = null;
    resetRisk();
    decisions.current.reset();
    zoneStop(publish);
    engineRef.current?.dispose(); engineRef.current = null;
    cam.stop(publish);
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    if (publish) {
      setLoadingEngine(false);
      setRisk(null); setResult(null); setFps(null); setFrameDims(null);
    }
  }, [cam.stop, zoneStop, monitor]);

  // Demo loop
  useEffect(() => {
    if (mode !== 'demo') return;
    let raf = 0; let last = 0;
    const loop = (t: number) => {
      if (sourceRef.current !== 'demo') return;
      if (t - last >= getPrefs().intervalMs) { last = t; handleFrame(simulateDemoFrame(t, zones.scenario.current, zones.demoStart.current), DEMO_W, DEMO_H, 'demo'); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, handleFrame]);

  const startLive = useCallback(async (facing: 'user' | 'environment') => {
    if (calibrationActiveRef.current) return;
    teardown();
    resetSession();
    setEngineError(null);
    setMode('live');
    sourceRef.current = 'live';
    zoneStart('live');
    if (getPrefs().audioAlerts) void armAudio().then(setAudioError);
    const session = ++sessionRef.current;
    monitor.enter('requesting', performance.now());
    const ok = await cam.start(facing);
    if (!ok || session !== sessionRef.current) return;
    monitor.enter('loading', performance.now());
    setLoadingEngine(true);
    setEngineStatus('Downloading models');
    const controller = new AbortController();
    modelAbort.current = controller;
    try {
      const engine = await waitFor(createVisionEngine((s) => { if (session === sessionRef.current) setEngineStatus(s); }, controller.signal, { objectProfile, calibrationHead: calibrationHead ?? undefined }), controller.signal, 60000, 'Vision model loading');
      if (session !== sessionRef.current) { engine.dispose(); return; }
      engineRef.current = engine;
      setLoadingEngine(false);
      setEngineStatus('Running on device');
      monitor.enter('waiting', performance.now());
      const watchdog = createFrameWatchdog(performance.now());
      let rejected = 0;
      const run = async () => {
        while (session === sessionRef.current) {
          const v = cam.videoRef.current;
          const started = performance.now();
          const decodedTime = sampleVideo();
          const decoded = frameDiagnostics();
          const observedAt = decoded?.observedAt ?? NaN;
          if (watchdog.fresh(Number.isFinite(decodedTime), decodedTime, started) && v &&
              Number.isFinite(observedAt) && observedAt <= started && started - observedAt < EVIDENCE_MAX_AGE_MS) {
            admitFrame();
            const { ticket, inference } = beginMonitoredInference(engine, v, monitor, started, observedAt);
            const r = await waitFor(inference, controller.signal, 30000, 'Local vision inference');
            if (session !== sessionRef.current) break;
            sampleVideo();
            const admitted = monitor.complete(ticket, r.frameTimeMs, performance.now());
            const timings = admitted ? handleFrame(r, r.frameWidth ?? v.videoWidth, r.frameHeight ?? v.videoHeight, 'live') : undefined;
            if (!admitted) rejected++;
            setPerformanceSample({ stages: r.stages, trackingMs: timings?.trackingMs ?? null,
              overlayMs: timings?.overlayMs ?? null, ageMs: performance.now() - ticket.started,
              admitted, rejected, skipped: frameDiagnostics()?.skipped ?? 0, decodeMs: decoded?.decodeMs ?? null,
              model: engine.diagnostics?.() });
          }
          const wait = Math.max(0, getPrefs().intervalMs - (performance.now() - started));
          await waitForDelay(wait, controller.signal);
        }
      };
      run().catch((e: unknown) => {
        if (session !== sessionRef.current) return;
        setEngineError(`Inference failed: ${(e as Error)?.message ?? String(e)}`);
        teardown();
        monitor.enter('error', performance.now(), `Inference failed: ${(e as Error)?.message ?? String(e)}. Restart the camera or use simulation.`);
      });
    } catch (e) {
      if (session !== sessionRef.current) return;
      setLoadingEngine(false);
      setEngineError(`Model load failed: ${(e as Error)?.message ?? String(e)}`);
      teardown();
      monitor.enter('error', performance.now(), `Model load failed. Check your connection and browser support, then retry.`);
    }
  }, [cam.start, cam.videoRef, handleFrame, resetSession, teardown, zoneStart, monitor, sampleVideo, frameDiagnostics, admitFrame, objectProfile, calibrationHead]);

  const replayDemo = (scenario?: ZoneScenario) => {
    if (calibrationActiveRef.current) return;
    teardown(); resetSession(); setEngineError(null);
    zoneStart('demo', scenario);
    sourceRef.current = 'demo'; setMode('demo');
    monitor.enter('simulation', performance.now());
    if (getPrefs().audioAlerts) void armAudio().then(setAudioError);
  };
  const startDemo = () => replayDemo();
  const stopAll = () => { teardown(); resetSession(); setEngineError(null); setMode('off'); };
  const switchFacing = () => {
    const next = prefs.facingMode === 'user' ? 'environment' : 'user';
    if (!setPrefs({ facingMode: next })) return;
    if (mode === 'live') startLive(next);
  };

  const teardownRef = useRef(teardown); teardownRef.current = teardown;
  useEffect(() => () => { teardownRef.current(false); resetRisk(); }, []);
  useEffect(() => {
    if (mode === 'live' && cam.status === 'error') {
      monitor.enter(/disconnected|interrupted/.test(cam.error ?? '') ? 'interrupted' : 'error', performance.now(), cam.error ?? undefined);
      sessionRef.current++; sourceRef.current = 'off';
      modelAbort.current?.abort();
      engineRef.current?.dispose(); engineRef.current = null;
      resetRisk();
      zoneStop();
      setLoadingEngine(false); setRisk(null); setResult(null); setFps(null); setFrameDims(null);
      canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [mode, cam.status, cam.error, zoneStop, monitor]);

  const liveReady = mode === 'live' && health.phase === 'fresh' && cam.status === 'running' && !loadingEngine && !engineError && !!engineRef.current && result !== null;
  const reactionReadiness = cameraResponseReadiness(mode, liveReady, result?.detections.map(d => d.label) ?? [], risk?.decision?.priority === 'check');
  const openResponseControls = () => {
    const details = responseDetails.current;
    if (!details) return;
    for (let d: HTMLElement | null = details; d; d = d.parentElement) if (d instanceof HTMLDetailsElement) d.open = true;
    details.querySelector('summary')?.focus({ preventScroll: true });
    details.scrollIntoView({ behavior: 'instant', block: 'start' });
  };
  const dims = mode === 'demo' ? { w: DEMO_W, h: DEMO_H } : frameDims ?? cam.dims ?? { w: 16, h: 9 };

  const takeSnapshot = () => {
    const v = cam.videoRef.current;
    sampleVideo();
    if (monitor.read().phase !== 'fresh') return;
    if (!liveReady || sourceRef.current !== 'live' || !v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
    setSnapshotError(null);
    try {
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      const context = c.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(v, 0, 0, c.width, c.height);
      const image = c.toDataURL('image/jpeg', 0.82);
      if (!image.startsWith('data:image/jpeg;base64,')) throw new Error('JPEG encoding failed');
      setSnapshot(image); setSnapOpen(true);
    } catch { setSnapshotError('A snapshot could not be captured. Wait for video to resume, then retry. Local monitoring can continue.'); }
  };
  const busy = cam.status === 'requesting' || loadingEngine;
  const error = cam.error ?? engineError;

  const observation = presentCurrentObservation(risk, mode === 'off' ? undefined : mode,
    mode === 'off' ? 'stopped' : health.phase === 'stale' ? 'stale' : error || health.phase === 'interrupted' || health.phase === 'error' ? 'unavailable'
      : mode === 'live' && !liveReady ? 'waiting' : risk ? 'available' : 'waiting',
    result?.frameTimeMs === undefined ? 'processing-time' : 'decoded-video');
  const sourceLabel = mode === 'demo' ? `${DEMO_W} x ${DEMO_H} schematic frame` : frameDims || cam.dims ? `${dims.w} x ${dims.h} source` : 'no source';

  const sourceState = mode === 'live'
    ? (cam.status === 'requesting' ? 'Waiting for permission' : loadingEngine ? 'Loading models' : error ? 'Unavailable' : health.phase === 'stale' ? 'Stale' : liveReady ? 'Live on device' : 'Starting')
    : mode === 'demo' ? 'Scripted, not live' : 'Off';
  const toggleAudio = () => {
    const enabled = !prefs.audioAlerts;
    if (!setPrefs({ audioAlerts: enabled })) return;
    if (enabled) void armAudio().then(setAudioError); else setAudioError(null);
  };

  return (
    <AppShell variant="brand">
      <div className="ssd" data-mode={mode}>
        <header className="ssd-head ssd-hero">
          <div className="min-w-0">
            <h1 className="ssd-title font-display">Your <span className="ssd-grad">monitor</span></h1>
            <p className="ssd-sub">{mode === 'live' ? 'Live video and speech processing stay on this device. Optional snapshot uploads need separate consent.' : mode === 'demo' ? 'Simulation: real scoring on scripted input. Not live.' : 'Use your camera to see people, posture and time spent in zones you define.'}</p>
          </div>
          <div className="ssd-state" data-testid="text-source-state">
            <span className="ssd-state-dot" aria-hidden="true" />
            <span className="ssd-state-k">Source</span>
            <span className="ssd-state-v">{mode === 'live' ? 'Device camera' : mode === 'demo' ? 'Simulation' : 'None'}</span>
            <span className="ssd-state-s">{sourceState}</span>
          </div>
        </header>

        <div className="ssd-bar" role="group" aria-label="Monitoring controls">
          <div className="ssd-seg" role="group" aria-label="Source" hidden={mode === 'off'}>
            <button onClick={() => startLive(prefs.facingMode)} disabled={busy || calibrationActive} data-testid="button-start-camera" aria-pressed={mode === 'live'} className="ssd-seg-btn" data-tone="lens">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              <span>{mode === 'live' ? 'Restart camera' : 'Device camera'}</span>
            </button>
            <button onClick={startDemo} data-testid="button-mode-demo" aria-pressed={mode === 'demo'} className="ssd-seg-btn" data-tone="sim">
              <Clapperboard className="h-4 w-4" /><span>Simulation</span>
            </button>
          </div>
          <details className="ssd-options">
            <summary>Camera options<ChevronRight className="h-4 w-4" /></summary>
          <div className="ssd-bar-r">
            <button onClick={switchFacing} data-testid="button-switch-facing" aria-label={`Camera facing: ${prefs.facingMode === 'user' ? 'front' : 'rear'}. Switch`} className="ssd-btn">
              <SwitchCamera className="h-4 w-4" />{prefs.facingMode === 'user' ? 'Front' : 'Rear'}
            </button>
            <button onClick={toggleAudio} data-testid="button-toggle-audio" aria-label="Toggle audio alerts" aria-pressed={prefs.audioAlerts} className="ssd-btn">
              {prefs.audioAlerts ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}<span className="ssd-hide-xs">{prefs.audioAlerts ? 'Audio on' : 'Audio off'}</span>
            </button>
          </div>
          </details>
            {mode !== 'off' && (
              <button onClick={stopAll} data-testid="button-stop" className="ssd-btn ssd-btn-stop">
                <Square className="h-3.5 w-3.5 fill-current" />Stop
              </button>
            )}
        </div>

        {audioError && <p role="alert" data-testid="status-audio-error" className="ssd-note ssd-note-warn">{audioError}</p>}
        {snapshotError && <p role="alert" data-testid="status-snapshot-error" className="ssd-note ssd-note-warn">{snapshotError}</p>}
        <CheckUnsaved />
      <section aria-label="Optional responses">
        {(responses.armed || responses.attempts.some(a => a.status === 'pending')) && <button type="button" className="ssd-btn ssd-btn-stop mb-2" onClick={responses.stop} data-testid="button-stop-response-actions">Stop response actions</button>}
      </section>
        {prefs.logThreshold === 'high' && <p className="ssd-note">High-only history logging withholds descriptive posture checks. No high-priority action detector is qualified. Zone flags remain separate.</p>}

        {mode === 'demo' && (
          <div className="ssd-simbar" data-testid="banner-go-live">
            <div className="min-w-0 flex-1">
              <p className="ssd-simbar-t">You are watching a simulation.</p>
              <p className="ssd-simbar-d">Scripted boxes on a drawing. Not live evidence.</p>
            </div>
            <button onClick={() => startLive(prefs.facingMode)} disabled={busy || calibrationActive} data-testid="button-go-live" className="ssd-btn ssd-btn-lens">
              <Camera className="h-4 w-4" />Use device camera
            </button>
          </div>
        )}

        <div className="ssd-grid">
          <div className="ssd-main order-1 min-w-0 xl:order-none" data-testid="section-camera">
            <MonitoringStatus health={health} restart={() => startLive(prefs.facingMode)} />
            <div className="ssd-frame">
              <div className="viewport-dark ssd-view relative mx-auto overflow-hidden" style={{ aspectRatio: `${dims.w} / ${dims.h}`, width: `min(100%, calc(68vh * ${dims.w / dims.h}))` }}>
                <video ref={cam.videoRef} muted playsInline className={cn('absolute inset-0 h-full w-full object-contain', mode === 'live' ? 'opacity-100' : 'opacity-0')} data-testid="video-live" />
                {mode === 'demo' && <img src={`${import.meta.env.BASE_URL}demo-scene.svg`} alt="Schematic workshop background. Scripted person boxes and posture are overlaid separately; they are not observations of real people." className="absolute inset-0 h-full w-full object-cover" />}
                <canvas ref={canvasRef} width={dims.w} height={dims.h} className={cn('absolute inset-0 h-full w-full', mode === 'off' && 'opacity-0')} data-testid="canvas-overlay" />
                {mode !== 'off' && <ZoneOverlay zone={zones.zone} draftRect={zones.draftRect} drawing={zones.drawing} onDrawn={zones.drawn} onCancel={zones.cancelDraw} width={dims.w} height={dims.h} persons={risk?.tracking.persons ?? []} />}
                {zones.drawing && <p className="ssd-drawhint pointer-events-none absolute inset-x-2 bottom-2 z-10">Drag a rectangle on the image. Press Escape to cancel. Numeric zone fields remain available below.</p>}

                <div className="ssd-tags pointer-events-none absolute left-2 top-2 z-10">
                  {mode === 'demo' && <span data-testid="status-simulation" className="ssd-tag ssd-tag-sim"><span className="sm:hidden">Simulation / not live</span><span className="hidden sm:inline">Simulation / scripted detections, not live inference</span></span>}
                  {liveReady && !loadingEngine && <span className="ssd-tag ssd-tag-live"><span className="ssd-rec" aria-hidden="true" />Live on-device inference</span>}
                  {mode === 'live' && health.phase === 'stale' && <span className="ssd-tag ssd-tag-warn">Stale / cannot assess</span>}
                </div>

                {(mode === 'off' || busy || (mode === 'live' && error)) && (
                  <div className="ssd-cover absolute inset-0 z-20 overflow-y-auto">
                    {error ? (
                      <div className="ssd-cover-in" data-testid="status-error">
                        <StateIllustration kind={/permission|denied|allowed/i.test(error) ? 'permission' : 'error'} className="ssd-ill" />
                        <p className="ssd-cover-t font-display">{/permission|denied|allowed/i.test(error) ? 'Camera permission was not granted' : 'Live monitoring unavailable'}</p>
                        <p className="ssd-cover-d">{error}</p>
                        {/permission|denied|allowed/i.test(error) && <p className="ssd-cover-d">Allow camera access in your browser's site settings, then retry. No assessment is shown without fresh video.</p>}
                        <div className="ssd-cover-a">
                          <button onClick={() => startLive(prefs.facingMode)} data-testid="button-retry" className="ssd-btn ssd-btn-lens"><RotateCcw className="h-4 w-4" />Retry camera</button>
                          <button onClick={startDemo} className="ssd-btn" data-testid="button-error-demo">Use simulation instead</button>
                        </div>
                      </div>
                    ) : busy ? (
                      <div className="ssd-cover-in" data-testid="status-loading">
                        <StateIllustration kind={cam.status === 'requesting' ? 'permission' : 'loading'} className="ssd-ill" />
                        <p className="ssd-cover-t font-display">{cam.status === 'requesting' ? 'Waiting for camera permission' : 'Preparing on-device models'}</p>
                        <p className="ssd-cover-d font-mono">{cam.status === 'requesting' ? 'Your browser will ask. Video stays on this device.' : engineStatus}</p>
                        <ol className="ssd-steps">
                          {[['Camera permission', cam.status !== 'requesting'], ['Download and load models', false]].map(([l, done], i) => (
                            <li key={i} data-done={done ? 'true' : 'false'}>
                              {done ? <Check className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}{l as string}
                            </li>
                          )).filter((_, i) => i === 0 || cam.status !== 'requesting')}
                        </ol>
                      </div>
                    ) : (
                      <div className="ssd-cover-in ssd-setup">
                        <StateIllustration kind="camera" className="ssd-ill" />
                        <p className="ssd-cover-t font-display">Start your camera</p>
                        <p className="ssd-cover-d">Your browser asks for permission only after you press Start. Live video is not recorded or uploaded. Observations may be saved on this device; snapshot review needs your consent.</p>
                        <ol className="ssd-howto">
                          <li><b>1</b>Allow camera</li><li><b>2</b>Models load locally</li><li><b>3</b>Observations appear</li>
                        </ol>
                        <div className="ssd-cover-a">
                          <button onClick={() => startLive(prefs.facingMode)} disabled={calibrationActive} data-testid="button-start-camera-empty" className="ssd-btn ssd-btn-lens ssd-btn-lg"><Play className="h-4 w-4" />Start {prefs.facingMode === 'user' ? 'front' : 'rear'} camera</button>
                        </div>
                        <p className="ssd-alt">No camera available? <button onClick={startDemo} data-testid="button-start-demo-empty" className="ssd-link">Run the labeled simulation</button></p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="ssd-strip">
                <span className="ssd-strip-src font-mono">{sourceLabel}</span>
                <div className="ssd-strip-overlays" role="group" aria-label="Overlays">
                  <Toggle checked={prefs.showBoxes} onChange={(v) => setPrefs({ showBoxes: v })} testId="checkbox-boxes" label="Boxes" />
                  <Toggle checked={prefs.showPose} onChange={(v) => setPrefs({ showPose: v })} testId="checkbox-pose" label="Pose" />
                </div>
                <button onClick={takeSnapshot} disabled={!liveReady || loadingEngine} data-testid="button-snapshot"
                  title={mode === 'demo' ? 'Scene review is only available for a real camera frame' : undefined}
                  className="ssd-btn ssd-btn-ink ssd-snap">
                  <Sparkles className="h-3.5 w-3.5" />Review snapshot with Gemini
                </button>
              </div>
              {mode === 'demo' && <p className="ssd-fine">Snapshot review requires a fresh camera frame and your consent. It is unavailable in simulation.</p>}
              <section className="mt-3 border-l-[3px] border-[hsl(var(--rule))] pl-3 text-xs" aria-label="Camera response readiness" data-testid="camera-response-readiness">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">Automatic responses: {responses.armed ? 'Enabled for this tab' : 'OFF'}</p>
                  <button type="button" className="ssd-btn" onClick={openResponseControls} data-testid="button-configure-responses">Configure / test responses</button>
                </div>
                <details className="mt-2" data-testid="response-readiness-details">
                <summary className="cursor-pointer text-muted-foreground">Supported triggers and response status</summary>
                <p className="mt-1">{reactionReadiness.input}</p>
                <p className="mt-1" data-testid="text-camera-tool-labels">{reactionReadiness.tools}</p>
                <p className="mt-1 text-muted-foreground">Scissors/knife labels and fast movement are not stabbing, attack or intent recognition, and do not trigger automatic responses. Current camera triggers: sustained horizontal posture and configured zone dwell only.</p>
                <p className="mt-1 text-muted-foreground">{responses.message}</p>
                </details>
              </section>
              {mode === 'live' && !liveReady && !busy && !error && <p className="ssd-fine">Snapshot review unlocks once a fresh frame has been analysed. Nothing is uploaded without your consent.</p>}
              {calibrationActive && <div className="mt-3 flex flex-wrap items-center gap-2" role="status">
                <p className="ssd-fine">The calibration lab owns the camera. Stop it or apply a qualified draft before starting monitoring.</p>
                <button type="button" className="ssd-btn ssd-btn-stop" onClick={calibration.stop} data-testid="button-stop-calibration-camera">Stop calibration camera</button>
              </div>}
            </div>

            {mode === 'demo' && (
              <section className="ssd-scen" aria-label="Scripted zone scenarios">
                <div className="min-w-0 flex-1">
                  <p className="ssd-scen-t font-display">Try a zone scenario</p>
                  <p className="ssd-scen-d">Bench A zone, four-second rule. A brief crossing stays under the limit; a sustained entry creates a flag to review. Scripted, not model predictions.</p>
                </div>
                <div className="ssd-scen-a">
                  <button className="ssd-btn" data-testid="button-scenario-brief" onClick={() => replayDemo('brief')}>Brief crossing</button>
                  <button className="ssd-btn ssd-btn-sim" data-testid="button-scenario-sustained" onClick={() => replayDemo('sustained')}>Sustained entry</button>
                </div>
              </section>
            )}
          </div>

          <aside className="ssd-side order-2 min-w-0 xl:order-none" aria-label="Current observation" data-testid="section-observation" hidden={mode === 'off' && zones.unsaved.length === 0 && zones.events.length === 0}>
            <ObservationAssessment presentation={observation} technicalCollapsed />
            {risk?.decision?.priority === 'check' && <Link href="/events" className="mt-3 inline-flex min-h-11 items-center text-sm underline">Open history to record a human check</Link>}
            <div className="ssd-card"><ZoneWorkflow zone={zones.zone} progress={zones.progress} events={zones.events} unsaved={zones.unsaved} onRetry={zones.retry} sessionId={zones.sessionId} /></div>
          </aside>

          <RecentReviewEvents />
          <section className="ssd-wide order-3 min-w-0 xl:order-none xl:col-span-2" aria-label="Optional speech and responses" data-testid="optional-monitoring-tools">
            <SpeechReviewPanel onCue={respond} compact />
            <details ref={responseDetails} className="ssd-disc" data-testid="responses-disclosure">
              <summary>Response actions · {responses.armed ? 'Enabled for this tab' : 'Off by default'}</summary>
              <ResponseControls controller={responses} />
            </details>
          </section>
          <section className="ssd-wide order-3 min-w-0 xl:order-none xl:col-span-2" aria-label="Zone configuration">
            <details className="ssd-disc ssd-disc-lg">
              <summary><ChevronRight className="ssd-chev ssd-chev-l h-4 w-4" /><span className="font-display ssd-disc-title">Set a zone</span></summary>
              <div className="ssd-disc-b">
                <p className="text-sm text-muted-foreground">Define a rectangle and dwell rule. Changes only take effect when applied.</p>
                <div className="mt-5">
                  <ZoneEditor zone={zones.zone} draftRect={zones.draftRect} drawing={zones.drawing} disabled={mode === 'off' || busy || (mode === 'live' && !liveReady)}
                    reason={zones.reason} onApply={zones.apply} onRemove={zones.remove} onDraw={() => { zones.draw(); canvasRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' }); }} onCancelDraw={zones.cancelDraw} />
                </div>
              </div>
            </details>
            <details className="ssd-disc mt-4">
              <summary>Zone history<ChevronRight className="ssd-chev h-4 w-4" /></summary>
              <div className="ssd-disc-b"><ZoneSessionSummary events={zones.allEvents} sessionId={zones.sessionId} /></div>
            </details>
          </section>

          <section className="ssd-wide order-4 min-w-0 xl:order-none xl:col-span-2" aria-label="Advanced and research" data-testid="section-advanced">
            <details className="ssd-disc ssd-adv" data-testid="advanced-disclosure">
              <summary><ChevronRight className="ssd-chev ssd-chev-l h-4 w-4" /><span className="font-display ssd-disc-title">Advanced / Research</span><span className="ssd-hist-n">model profile, calibration, diagnostics</span></summary>
              <div className="ssd-disc-b ssd-adv-b">
                <p className="text-xs text-muted-foreground">Research controls for the presenter. Collapsing this section does not stop the camera, calibration or microphone. Balanced is the default profile; Detail is experimental.</p>
                <CandidateAvailability />
          <section aria-label="Secondary session rule history" data-testid="session-rule-history" className="ssd-hist min-w-0">
            <details className="ssd-disc">
            <summary><Activity className="h-4 w-4" /><span className="font-display ssd-disc-title">Session history</span><span className="ssd-hist-n">{marks.length} level change{marks.length === 1 ? '' : 's'}</span><ChevronRight className="ssd-chev h-4 w-4" /></summary>
            <div className="ssd-hist-g ssd-disc-b">
              <Panel title="Session rule score" icon={<Activity className="h-4 w-4" />} right={mode !== 'off' && <SourceBadge source={mode === 'live' ? 'live' : 'demo'} />}>
                <div className="h-44" data-testid="chart-score">
                  {series.length < 2 ? (
                    <div className="flex h-full items-center justify-center"><p className="text-center text-sm text-muted-foreground">Score history appears once frames are processed.</p></div>
                  ) : (
                    <ResponsiveContainer>
                      <AreaChart data={series} margin={{ left: -24, right: 4, top: 8 }}>
                        <CartesianGrid vertical={false} stroke="hsl(38 18% 90%)" />
                        <XAxis dataKey="t" tick={{ fill: 'hsl(228 12% 40%)', fontSize: 10, fontFamily: 'Geist Mono' }} tickFormatter={(v) => `${v}s`} stroke="transparent" />
                        <YAxis domain={[0, 100]} ticks={[0, 30, 70, 100]} tick={{ fill: 'hsl(228 12% 40%)', fontSize: 10, fontFamily: 'Geist Mono' }} stroke="transparent" />
                        <ReferenceLine y={30} stroke="hsl(30 92% 38% / 0.6)" strokeDasharray="4 4" />
                        <ReferenceLine y={70} stroke="hsl(352 72% 46% / 0.6)" strokeDasharray="4 4" />
                        <Tooltip contentStyle={{ background: 'hsl(42 40% 99%)', border: '1px solid hsl(38 18% 85%)', borderRadius: 8, fontSize: 12, color: 'hsl(230 35% 11%)' }} labelFormatter={(v) => `${v}s`} />
                        <Area type="monotone" dataKey="score" stroke={mode === 'demo' ? 'hsl(262 55% 44%)' : 'hsl(234 82% 52%)'} strokeWidth={2} fill={mode === 'demo' ? 'hsl(262 55% 50% / 0.08)' : 'hsl(234 82% 52% / 0.08)'} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
                {mode === 'demo' && <p className="mt-2 text-[11px] text-sim">Demo data: scores computed by the real heuristic on scripted, simulated input.</p>}
              </Panel>
              <Panel title="Human-check timeline" icon={<ListTree className="h-4 w-4" />}>
                <div className="relative max-h-44 overflow-y-auto pr-1" data-testid="list-timeline">
                  {marks.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">Human-check changes will be listed here.</p>}
                  {marks.length > 0 && <span className="absolute bottom-2 left-[3px] top-2 w-px bg-[hsl(var(--rule))]" />}
                  {marks.map((m) => (
                    <div key={m.ts + m.level} className="relative flex items-start gap-3 py-1.5">
                      <span className="mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: LEVEL_COLOR[m.level] }} />
                      <span className="font-mono text-[11px] text-muted-foreground">{new Date(m.ts).toLocaleTimeString()}</span>
                      <span className="min-w-0 flex-1 truncate text-xs" title={m.note}><span className="font-mono font-medium uppercase" style={{ color: LEVEL_COLOR[m.level] }}>{m.level === 'moderate' ? 'Check suggested' : 'No check triggered'}</span> / {m.note}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
            </details>
          </section>
              <ToolMotionPanel profile={objectProfile} onProfileChange={setObjectProfile} disabled={mode !== 'off' || busy}
                evidence={toolMotion} fresh={liveReady} source={mode} />
              <CalibrationPanel controller={calibration} disabled={mode !== 'off' || busy} />
              {calibrationHead && <div className="ssd-fine" data-testid="calibration-live-review">
                <strong>Personal crop review · experimental, tab-only.</strong>{' '}
                {mode !== 'live' ? 'Start Balanced-profile monitoring to try crop suggestions. Simulation does not use this classifier.' :
                  !liveReady ? 'Waiting for fresh admitted camera evidence. No current crop opinion.' :
                  result?.calibrationReview?.prediction ? <>
                    Base label: {result.calibrationReview.baseLabel}. Calibrated crop:{' '}
                    {result.calibrationReview.prediction.uncertain ? `uncertain (leading class: ${result.calibrationReview.prediction.candidate})` : result.calibrationReview.prediction.label}.
                    {' '}Class score {(result.calibrationReview.prediction.classScore * 100).toFixed(0)}%; not a danger probability.
                  </> : result?.calibrationReview?.status ?? 'Waiting for a supported object crop.'}
                {' '}This does not locate missed objects, change detector labels, recognise actions or trigger responses.
              </div>}
              {liveReady && <p className="ssd-fine" data-testid="tool-scan-performance">Latest admitted scan: {result?.objectProfile ?? 'balanced'} · {result?.objectPasses ?? 1} object pass(es) · {result?.latency.toFixed(0)} ms total inference. Extra detail passes are skipped near the freshness deadline.</p>}
            <details className="ssd-disc" data-testid="monitor-diagnostics">
              <summary><ScanEye className="h-4 w-4" />Details: detections and performance<ChevronRight className="ssd-chev h-4 w-4" /></summary>
              <div className="ssd-disc-b space-y-5">
                {risk && <TrackingEvidence details={motionEvidence(risk.tracking, mode === 'demo' ? 'simulation' : result?.frameTimeMs === undefined ? 'processing-time' : 'decoded-video')} />}
                <div className="ssd-metrics">
                  <Metric label="Inference FPS" value={liveReady && fps !== null ? `${fps}` : mode === 'demo' ? 'n/a' : '--'} hint={mode === 'demo' ? 'simulation' : 'measured'} testId="text-fps" live={liveReady} />
                  <Metric label="Latency" value={liveReady && result ? `${result.latency.toFixed(0)} ms` : mode === 'demo' ? 'n/a' : '--'} hint={mode === 'demo' ? 'simulation' : 'per frame'} testId="text-latency" live={liveReady} />
                </div>
                {mode === 'live' && performanceSample && <div className="text-xs text-muted-foreground space-y-1" data-testid="pipeline-performance">
                  <p>Last completed attempt: {performanceSample.admitted ? 'admitted' : 'rejected / cannot assess'}.
                    {' '}Evidence age {performanceSample.ageMs.toFixed(0)} ms; strict limit 2500 ms.</p>
                  <p>Capture {performanceSample.stages?.captureMs.toFixed(1) ?? '—'} ms ·
                    {' '}Objects {performanceSample.stages?.objectMs.toFixed(0) ?? '—'} ms ·
                    {' '}Pose {performanceSample.stages?.skippedPose ? 'skipped (expired)' : `${performanceSample.stages?.poseMs.toFixed(0) ?? '—'} ms`} ·
                    {' '}Tracking {performanceSample.trackingMs?.toFixed(1) ?? '—'} ms ·
                    {' '}Overlay {performanceSample.overlayMs?.toFixed(1) ?? '—'} ms</p>
                  <p>Decode {performanceSample.decodeMs === null ? 'not reported' : `${performanceSample.decodeMs.toFixed(1)} ms`} ·
                    {' '}{performanceSample.skipped} presented frames not selected · {performanceSample.rejected} stale results rejected.</p>
                  <p>{performanceSample.model?.backend ?? 'unknown'} object backend; CPU pose, main-thread execution.
                    {' '}Worker acceleration not enabled; browser timings are not physical-phone measurements.</p>
                  <p>TF tensors {performanceSample.model?.memory.numTensors ?? '—'} ·
                    {' '}TF bytes {performanceSample.model?.memory.numBytes ?? '—'} (not total browser / WASM / GPU memory).</p>
                </div>}
                <Panel title="Detections" icon={<ScanEye className="h-4 w-4" />} right={<span className="font-mono text-xs text-muted-foreground">min {(prefs.minConfidence * 100).toFixed(0)}%</span>}>
                  <div className="space-y-3" data-testid="list-detections">
                    {!result?.detections.length && <p className="py-3 text-center text-sm text-muted-foreground">{mode === 'off' ? 'Not monitoring.' : mode === 'live' && !liveReady ? 'No current detections available.' : 'Nothing above the confidence threshold in the current frame.'}</p>}
                    {result?.detections.map((d, i) => (
                      <div key={d.id + i}>
                        <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm capitalize">{d.label}</span><span className="font-mono text-xs tabular-nums">{(d.confidence * 100).toFixed(1)}%</span></div>
                        <div className="ssd-meter"><div className={mode === 'demo' ? 'ssd-meter-sim' : 'ssd-meter-lens'} style={{ width: `${d.confidence * 100}%` }} /></div>
                      </div>
                    ))}
                    {result && <p className="pt-1 font-mono text-[11px] text-muted-foreground">{result.landmarks.length} pose{result.landmarks.length === 1 ? '' : 's'} tracked</p>}
                  </div>
                </Panel>
                {mode === 'demo' && <p className="text-xs text-sim">Detection percentages above are scripted annotations, not calibrated probabilities or live model measurements.</p>}
              </div>
            </details>
            <details className="ssd-disc">
              <summary><Cpu className="h-4 w-4" />What is running?<ChevronRight className="ssd-chev h-4 w-4" /></summary>
              <div className="ssd-disc-b space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p><span className="font-medium text-foreground">Objects:</span> TensorFlow.js COCO-SSD, 80 everyday classes, in your browser.</p>
                <p><span className="font-medium text-foreground">Posture:</span> MediaPipe Pose Landmarker, 33 body points per person.</p>
                <p><span className="font-medium text-foreground">Legacy score:</span> retained as a diagnostic comparison only. It never triggers the context workflow. Human checks use fresh, sustained per-person observations; zones remain separate.</p>
                <p><span className="font-medium text-foreground">Simulation:</span> the same scorer, fed scripted detections over a schematic illustration. It does not test detection accuracy.</p>
                <p><span className="font-medium text-foreground">Not included:</span> fall or action recognition, identity, or measured real-world distance.</p>
              </div>
            </details>
              </div>
            </details>
          </section>
        </div>
      </div>

      {snapOpen && snapshot && <SnapshotDialog key={snapshot} open onOpenChange={(open) => { setSnapOpen(open); if (!open) setSnapshot(null); }} image={snapshot} />}
    </AppShell>
  );
}

const EVENT_KIND: Record<SafetyEvent['kind'], string> = { risk: 'Human-check observation', analysis: 'Snapshot review (AI opinion)', zone: 'Zone dwell flag' };

function RecentReviewEvents() {
  const events = useEvents();
  const recent = events.slice(0, 5);
  return (
    <section className="ssd-wide ssd-recent order-3 min-w-0 xl:order-none xl:col-span-2" aria-labelledby="recent-events-title" data-testid="section-recent-events">
      <div className="ssd-recent-h">
        <h2 id="recent-events-title" className="font-display ssd-disc-title">Recent review events</h2>
        <span className="ssd-hist-n" data-testid="text-recent-count">{recent.length} of {events.length} saved on this device</span>
        <Link href="/events" className="ssd-link ml-auto inline-flex items-center gap-1" data-testid="link-recent-events">Open history<ChevronRight className="h-4 w-4" /></Link>
      </div>
      <p className="text-xs text-muted-foreground">Prompts for a person to review. Stored values are rule or model outputs, not probabilities or verdicts. An empty list does not mean the scene is safe.</p>
      {recent.length === 0 ? (
        <p className="ssd-recent-empty" data-testid="text-recent-empty">No review events saved yet.</p>
      ) : (
        <ul className="ssd-recent-l" data-testid="list-recent-events">
          {recent.map((e) => (
            <li key={e.id} className="ssd-recent-i" data-testid={`row-recent-event-${e.id}`}>
              <span className="font-mono text-[11px] text-muted-foreground" data-testid={`text-recent-time-${e.id}`}>{new Date(e.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className="min-w-0 flex-1 truncate text-sm" data-testid={`text-recent-kind-${e.id}`}>{EVENT_KIND[e.kind]}{e.review?.status ? <span className="text-muted-foreground"> / review {e.review.status}</span> : null}</span>
              <SourceBadge source={e.source} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Toggle({ checked, onChange, testId, label }: { checked: boolean; onChange: (v: boolean) => void; testId: string; label: string }) {
  return (
    <label className="ssd-toggle" data-on={checked ? 'true' : 'false'}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" data-testid={testId} />
      <span className="ssd-toggle-box">{checked && <Check className="h-3 w-3" strokeWidth={3} />}</span>
      {label}
    </label>
  );
}

function Metric({ label, value, hint, testId, live, className }: { label: string; value: string; hint: string; testId: string; live?: boolean; className?: string }) {
  return (
    <div className={cn('ssd-metric', className)}>
      <div className="ssd-metric-k">{label}</div>
      <div className="ssd-metric-v font-display tabular-nums" data-testid={testId}>{value}</div>
      <div className="ssd-metric-h">{live && <span className="ssd-metric-dot" aria-hidden="true" />}{hint}</div>
    </div>
  );
}

function SnapshotDialog({ open, onOpenChange, image }: { open: boolean; onOpenChange: (o: boolean) => void; image: string | null }) {
  const [context, setContext] = useState('');
  const [res, setRes] = useState<SceneAssessment | null>(null);
  const gate = useRef(createRequestGate());
  const abort = useRef<AbortController | null>(null);
  const [unsaved, setUnsaved] = useState<(Omit<SafetyEvent, 'id' | 'ts'> & { ts: number }) | null>(null);
  const analyze = useAnalyzeScene({ mutation: {
    mutationFn: ({ data }) => {
      abort.current = new AbortController();
      return analyzeScene(data, { signal: AbortSignal.any([abort.current.signal, AbortSignal.timeout(55000)]) });
    },
  } });
  useLayoutEffect(() => () => { gate.current.invalidate(); abort.current?.abort(); }, []);
  const changeOpen = (next: boolean) => {
    if (!next) { gate.current.invalidate(); abort.current?.abort(); }
    onOpenChange(next);
  };

  const send = async () => {
    if (!open || !image || res) return;
    const ticket = gate.current.begin();
    if (ticket === null) return;
    const ts = Date.now();
    try {
      const r = await analyze.mutateAsync({ data: { image, context: context.trim() || undefined } });
      if (!gate.current.current(ticket)) return;
      setRes(r);
      const event = { source: 'live' as const, kind: 'analysis' as const, level: r.risk, score: null, evidence: r.evidence, detections: 0, summary: r.summary, recommendations: r.recommendations, limitations: r.limitations, ts };
      if (!addEvent(event)) setUnsaved(event);
    } catch { /* Query error is rendered below; never echo image/context. */ }
    finally { gate.current.finish(ticket); }
  };
  const errMsg = analyze.error ? ((analyze.error as { message?: string }).message ?? 'Request failed') : null;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl border-[hsl(var(--rule))] bg-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><Sparkles className="h-4 w-4 text-lens" />Scene review</DialogTitle>
          <DialogDescription>A single still frame, reviewed by Gemini only if you send it.</DialogDescription>
        </DialogHeader>
        {image && <img src={image} alt="Captured snapshot" className="w-full rounded-xl ring-1 ring-[hsl(var(--rule))]" data-testid="img-snapshot" />}
        {!res && (
          <>
            <Textarea value={context} disabled={analyze.isPending} maxLength={1000} onChange={(e) => setContext(e.target.value.slice(0, 1000))} placeholder="Optional context, e.g. 'chemistry lab, one student working alone'" className="bg-[hsl(var(--muted))]" data-testid="input-context" />
            <div className="rounded-xl border border-[hsl(36_70%_78%)] bg-[hsl(40_90%_95%)] p-3 text-xs leading-relaxed text-[hsl(30_70%_22%)]" data-testid="text-consent">
              By clicking send, this exact image and your context text will be uploaded to the VANTYR server and forwarded to Google Gemini for analysis. Only send it if everyone visible is aware. The result is an AI opinion that may be wrong, and it does not certify the scene as safe.
            </div>
            {analyze.isPending && <p className="text-xs text-muted-foreground">Closing stops waiting for this review. An image already uploaded cannot be recalled; no late result will be saved after closing.</p>}
            {errMsg && <p className="rounded-lg bg-[hsl(352_80%_96%)] p-3 text-sm text-[hsl(var(--hot))] ring-1 ring-[hsl(352_60%_84%)]" data-testid="status-analysis-error">Analysis failed: {errMsg}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => changeOpen(false)} className="flex items-center gap-1.5 btn-ghost px-3 py-2 text-sm" data-testid="button-discard-snapshot"><X className="h-4 w-4" />{analyze.isPending ? 'Close review' : 'Discard'}</button>
              <button onClick={send} disabled={analyze.isPending} className="flex items-center gap-1.5 rounded-lg btn-primary px-4 py-2 text-sm disabled:opacity-60" data-testid="button-send-snapshot">
                {analyze.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{analyze.isPending ? 'Analyzing' : errMsg ? 'I consent, retry' : 'I consent, send snapshot'}
              </button>
            </div>
          </>
        )}
        {res && <AssessmentView r={res} />}
        {unsaved && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="status-review-unsaved">
          Review received, but it was not saved to history. Keep this dialog open until you can save it.
          <button className="ml-2 underline" data-testid="button-retry-save-review" onClick={() => { if (addEvent(unsaved)) setUnsaved(null); }}>Retry saving without uploading again</button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}


export function AssessmentView({ r }: { r: SceneAssessment }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4" data-testid="card-assessment">
      <div className="flex items-center gap-2"><LevelBadge level={r.risk} testId="status-ai-risk" /><span className="text-xs text-muted-foreground">Gemini opinion on one frame</span></div>
      <p className="text-[15px] leading-relaxed">{r.summary}</p>
      {r.evidence.length > 0 && <div><p className="eyebrow mb-2 text-muted-foreground">Evidence</p><ul className="space-y-1.5 text-sm">{r.evidence.map((e, i) => <li key={i} className="flex gap-2.5 border-b border-[hsl(var(--rule))] py-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--lens))]" />{e}</li>)}</ul></div>}
      {r.recommendations.length > 0 && <div><p className="eyebrow mb-2 text-muted-foreground">Recommendations</p><ul className="space-y-1.5 text-sm">{r.recommendations.map((e, i) => <li key={i} className="flex gap-2.5 border-b border-[hsl(var(--rule))] py-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--warn))]" />{e}</li>)}</ul></div>}
      <p className="rounded-lg bg-[hsl(40_90%_95%)] p-3 text-xs text-[hsl(30_30%_28%)]"><span className="font-medium text-[hsl(30_70%_22%)]">Limitations: </span>{r.limitations}</p>
    </motion.div>
  );
}
