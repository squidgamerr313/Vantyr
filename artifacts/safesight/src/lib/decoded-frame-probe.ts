/** Playback currentTime can advance without decoded images. Prefer presented-frame metadata. */
export function createDecodedFrameProbe(video: HTMLVideoElement) {
  const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';
  let source = video.srcObject, time = NaN, count: number | null = null;
  let callback = 0, stopped = false;
  let observedAt = NaN, decodeMs: number | null = null, presented = 0, skipped = 0;
  let admittedCount = 0;
  const syncSource = () => {
    if (source !== video.srcObject) {
      source = video.srcObject; time = observedAt = NaN; count = null;
      decodeMs = null; presented = skipped = admittedCount = 0;
    }
  };
  const schedule = () => {
    if (stopped || !video.requestVideoFrameCallback) return;
    const owner = video.srcObject;
    callback = video.requestVideoFrameCallback((_now, metadata) => {
      if (stopped) return;
      syncSource();
      if (owner === video.srcObject && owner) {
        time = metadata.mediaTime; observedAt = _now;
        decodeMs = typeof metadata.processingDuration === 'number' && Number.isFinite(metadata.processingDuration) ? metadata.processingDuration * 1000 : null;
        presented = metadata.presentedFrames ?? presented + 1;
      }
      schedule();
    });
  };
  schedule();
  return {
    read() {
      syncSource();
      if (stopped) return NaN;
      if (!video.requestVideoFrameCallback) {
        const quality = video.getVideoPlaybackQuality?.();
        // Dropped frames can advance the playback clock without a usable image.
        const decoded = quality ? quality.totalVideoFrames - quality.droppedVideoFrames : NaN;
        if (Number.isFinite(decoded) && decoded! > 0 && decoded !== count) {
          count = decoded!; time = video.currentTime; observedAt = performance.now(); presented = decoded!;
        }
      }
      return source && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 ? time : NaN;
    },
    /** Decode duration is browser-reported, not an inference or playback-clock estimate. */
    diagnostics() { syncSource(); return { observedAt, decodeMs, presented, skipped, admittedCount,
      method: hasFrameCallback ? 'presented-frame-callback' : 'decode-counter' }; },
    admit() {
      // Frames not selected for inference are intentionally dropped, never queued.
      skipped = Math.max(0, presented - (++admittedCount));
    },
    stop() { stopped = true; time = observedAt = NaN; if (callback) video.cancelVideoFrameCallback?.(callback); },
  };
}
