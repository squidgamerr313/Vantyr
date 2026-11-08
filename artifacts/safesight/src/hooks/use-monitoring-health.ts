import { useEffect, useRef, useState } from 'react';
import { createMonitoringHealth, type MonitoringHealth } from '@/lib/monitoring-health';
import { createDecodedFrameProbe } from '@/lib/decoded-frame-probe';

export function useMonitoringHealth(video: React.RefObject<HTMLVideoElement | null>, invalidate: () => void) {
  const [health, setHealth] = useState<MonitoringHealth>({
    phase: 'simulation', reason: 'Scripted simulation only. Live camera health is not being assessed.',
  });
  const invalidateRef = useRef(invalidate); invalidateRef.current = invalidate;
  const controller = useRef<ReturnType<typeof createMonitoringHealth> | null>(null);
  if (!controller.current) controller.current = createMonitoringHealth({
    publish: setHealth, invalidate: () => invalidateRef.current(),
  });
  const monitor = controller.current;
  const probe = useRef<ReturnType<typeof createDecodedFrameProbe> | null>(null);
  const sampleVideo = () => {
    const time = probe.current?.read() ?? NaN;
    monitor.sample(Number.isFinite(time), time, performance.now(), probe.current?.diagnostics().observedAt);
    return time;
  };
  useEffect(() => {
    if (video.current) probe.current = createDecodedFrameProbe(video.current);
    // Independent of rendering and pending inference: neither can keep evidence fresh.
    const timer = setInterval(() => {
      const time = probe.current?.read() ?? NaN;
      monitor.sample(Number.isFinite(time), time, performance.now(), probe.current?.diagnostics().observedAt);
    }, 250);
    return () => { clearInterval(timer); probe.current?.stop(); probe.current = null; };
  }, [monitor, video]);
  // Ref-backed reader is stable for orchestration callbacks.
  const sampleRef = useRef(sampleVideo); sampleRef.current = sampleVideo;
  const sampleStable = useRef(() => sampleRef.current());
  const frameDiagnostics = useRef(() => probe.current?.diagnostics());
  const admitFrame = useRef(() => probe.current?.admit());
  return { health, monitor, sampleVideo: sampleStable.current,
    frameDiagnostics: frameDiagnostics.current, admitFrame: admitFrame.current };
}
