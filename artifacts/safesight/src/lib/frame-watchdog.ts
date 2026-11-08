/** Only new decoded camera frames may advance a temporal risk assessment. */
export function createFrameWatchdog(start: number, timeoutMs = 15000) {
  let lastMediaTime: number | null = null;
  let lastFreshAt = start;
  return {
    fresh(ready: boolean, mediaTime: number, now: number) {
      if (ready && Number.isFinite(mediaTime) && mediaTime !== lastMediaTime) {
        lastMediaTime = mediaTime; lastFreshAt = now; return true;
      }
      if (now - lastFreshAt >= timeoutMs) throw new Error('Camera frames stopped arriving. Restart the camera or switch to simulation.');
      return false;
    },
  };
}
