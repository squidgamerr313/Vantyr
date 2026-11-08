import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VisionResult } from '@/lib/vision';
import type { TrackingSummary } from '@/lib/person-tracking';
import { addEvent, getPrefs, useEvents, type SafetyEvent, type Source } from '@/lib/store';
import { createZoneMonitor, EMPTY_ZONE_PROGRESS, validRect, validZone, type ZoneProgress } from '@/lib/zone-monitor';
import { DEMO_ZONE, type ZoneScenario, type DemoScenario } from '@/lib/zone-demo';
import type { ZoneConfig, ZoneRect } from '@/lib/zone-records';
import { playAlert } from '@/lib/audio';
import { getPendingZoneFlags, queueZoneFlag, retryZoneFlag, useZoneOutbox } from '@/lib/zone-outbox';
import type { ResponseEvent } from '@/lib/responses';

const session = (source: Source) => ({ id: crypto.randomUUID(), startedAt: Date.now(), source });
export function useZoneSession(onAudioError: (error: string | null) => void, onResponse?: (event: ResponseEvent) => boolean) {
  const [current, setCurrent] = useState(() => session('demo'));
  const [zone, setZone] = useState<ZoneConfig | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draftRect, setDraftRect] = useState<ZoneRect | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [progress, setProgress] = useState<ZoneProgress>(EMPTY_ZONE_PROGRESS);
  const unsaved = useZoneOutbox();
  const allEvents = useEvents();
  const monitor = useRef(createZoneMonitor());
  const active = useRef(true);
  const currentRef = useRef(current);
  const zoneRef = useRef<ZoneConfig | null>(null);
  const latest = useRef<{ time: number | undefined; aspect: number; freshWall: number } | null>(null);
  const lastUi = useRef(-Infinity);
  const progressRef = useRef<ZoneProgress>(EMPTY_ZONE_PROGRESS);
  const scenario = useRef<DemoScenario>('scene');
  const demoStart = useRef(performance.now());

  const clear = useCallback((message: string | null, publish = true) => {
    zoneRef.current = null; monitor.current.reset(); progressRef.current = EMPTY_ZONE_PROGRESS;
    if (publish) { setZone(null); setProgress(EMPTY_ZONE_PROGRESS); setDrawing(false); setDraftRect(null); setReason(message); }
  }, []);
  const apply = useCallback((input: Omit<ZoneConfig, 'id'>) => {
    const next = { name: input.name.trim(), rect: [...input.rect] as ZoneRect, dwellSec: input.dwellSec, id: crypto.randomUUID() };
    if (!active.current || !validZone(next)) { setReason('Use a named zone within the image and an integer duration from 1 to 60 seconds.'); return; }
    monitor.current.reset(); zoneRef.current = next; progressRef.current = { status: 'watching', occupants: [] };
    setZone(next); setProgress(progressRef.current); setDraftRect(null); setDrawing(false); setReason(null);
  }, []);
  const start = useCallback((source: Source, nextScenario?: ZoneScenario) => {
    clear('New camera/source session: draw or apply a zone after fixing the camera position.');
    active.current = true;
    const next = session(source); currentRef.current = next; setCurrent(next);
    latest.current = null; lastUi.current = -Infinity;
    if (source === 'demo') {
      scenario.current = nextScenario ?? 'scene'; demoStart.current = performance.now();
      if (nextScenario) apply({ ...DEMO_ZONE, rect: [...DEMO_ZONE.rect] });
    }
  }, [apply, clear]);
  const stop = useCallback((publish = true) => { active.current = false; latest.current = null; clear('Monitoring stopped. Apply a zone again after restarting.', publish); }, [clear]);
  const invalidate = useCallback(() => {
    // Preserve saved flags and zone geometry, never carry dwell across missing evidence.
    monitor.current.reset(); latest.current = null;
    progressRef.current = zoneRef.current ? { status: 'stale', occupants: [] } : EMPTY_ZONE_PROGRESS;
    setProgress(progressRef.current);
  }, []);
  const process = useCallback((frame: VisionResult, tracking: TrackingSummary, w: number, h: number, source: Source, now: number) => {
    if (!active.current || currentRef.current.source !== source) return { config: null, progress: EMPTY_ZONE_PROGRESS };
    const aspect = w / h;
    if (zoneRef.current && latest.current && Math.abs(latest.current.aspect - aspect) > .01) {
      clear('The video shape changed. Fix the camera position and redraw or apply the zone again.');
    }
    const prior = latest.current;
    latest.current = { time: frame.frameTimeMs, aspect, freshWall: prior && prior.time === frame.frameTimeMs ? prior.freshWall : now };
    if (zoneRef.current && tracking.persons.some((p) => p.limitations.some((l) => l.startsWith('Shared image motion')))) {
      clear('Shared image movement may indicate camera movement. Check the camera and apply the zone again.');
    }
    if (getPendingZoneFlags().length >= 50) {
      monitor.current.reset();
      progressRef.current = { status: 'uncertain', occupants: [] };
      setProgress(progressRef.current); setReason('Zone observation is paused: 50 unsaved flags need saving. Restore browser storage and retry before continuing.');
      return { config: zoneRef.current, progress: progressRef.current };
    }
    const result = monitor.current.tick({
      zone: zoneRef.current, sessionId: currentRef.current.id, sessionStartedAt: currentRef.current.startedAt,
      source, persons: tracking.persons, frameTimeMs: frame.frameTimeMs, now,
    });
    for (const observation of result.triggers) {
      const text = `${observation.personLabel} detected inside ${observation.zone.name}'s marked image zone for ${(observation.dwellMs / 1000).toFixed(1)} seconds.`;
      const event: SafetyEvent = {
        id: crypto.randomUUID(), ts: Math.max(Date.now(), observation.sessionStartedAt), source, kind: 'zone', level: 'uncertain', score: null,
        summary: text, evidence: [text, `Configured threshold: ${observation.zone.dwellSec} seconds. Membership uses the bottom-center of the detected bounding box in the 2D image.`],
        detections: frame.detections.length, zone: observation, review: { status: 'open', actions: [] },
        limitations: 'An image-zone observation is not verified danger, real-world distance, machinery status or confirmed access. A human must check the situation. Track labels are anonymous and session-local.',
      };
      if (!addEvent(event)) queueZoneFlag(event);
      const handled = source === 'live' && onResponse?.({ id: `zone:${observation.episodeId}`, kind: 'camera-zone', at: Date.now(), source: 'live' });
      if (getPrefs().audioAlerts && !handled) {
        window.dispatchEvent(new Event('vantyr:response-audio'));
        void playAlert().then(onAudioError);
      }
    }
    progressRef.current = { status: result.status, occupants: result.occupants };
    if (now - lastUi.current >= 200 || result.triggers.length) { lastUi.current = now; setProgress(progressRef.current); }
    return { config: zoneRef.current, progress: progressRef.current };
  }, [clear, onAudioError, onResponse]);
  // The camera watchdog skips frozen frames; independently make stale zone evidence visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!active.current || !zoneRef.current || currentRef.current.source !== 'live' || !latest.current) return;
      if (performance.now() - latest.current.freshWall > 2500 && progressRef.current.status !== 'stale') {
        monitor.current.reset();
        progressRef.current = { status: 'stale', occupants: [] }; setProgress(progressRef.current);
      }
    }, 500);
    return () => { clearInterval(timer); monitor.current.reset(); };
  }, []);
  const retry = useCallback((episodeId: string) => {
    if (retryZoneFlag(episodeId) && getPendingZoneFlags().length < 50)
      setReason((old) => old?.startsWith('Zone observation is paused:') ? null : old);
  }, []);
  const draw = useCallback(() => { clear(null); setDrawing(true); }, [clear]);
  const drawn = useCallback((rect: ZoneRect) => {
    setDraftRect(rect); setDrawing(false);
    setReason(validRect(rect) ? 'Drawing ready. Apply the zone to start its timer.' : 'The rectangle must be at least 2% of the image in each dimension. Adjust the values below.');
  }, []);
  const cancelDraw = useCallback(() => { setDrawing(false); setReason('Drawing cancelled. Apply a zone to resume observation.'); }, []);
  const events = useMemo(() => allEvents.filter((e) => e.kind === 'zone' && e.zone?.sessionId === current.id && e.source === current.source), [allEvents, current]);
  return {
    sessionId: current.id, zone, drawing, draftRect, reason, progress, unsaved, allEvents, events, scenario, demoStart,
    process, start, stop, invalidate, apply, draw, drawn, cancelDraw, retry,
    remove: useCallback(() => clear(null), [clear]),
  };
}
