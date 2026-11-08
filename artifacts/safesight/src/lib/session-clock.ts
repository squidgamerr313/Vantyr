/** Per-session gates. No clocks or logging state may carry from simulation to live. */
export function createSessionClock(start = 0) {
  let origin = start;
  let lastLog: number | null = null;
  let lastUi = -Infinity;
  let lastPoint = -Infinity;
  let frames: number[] = [];
  return {
    reset(now: number) { origin = now; lastLog = null; lastUi = -Infinity; lastPoint = -Infinity; frames = []; },
    logDue(now: number, cooldownSec: number) {
      if (lastLog !== null && now - lastLog < cooldownSec * 1000) return false;
      lastLog = now; return true;
    },
    pointDue(now: number) {
      if (now - lastPoint < 500) return false;
      lastPoint = now; return true;
    },
    uiDue(now: number) {
      if (now - lastUi < 200) return false;
      lastUi = now; return true;
    },
    frame(now: number) {
      frames.push(now);
      frames = frames.filter((t) => now - t < 1000);
      return frames.length;
    },
    seconds(now: number) { return +((now - origin) / 1000).toFixed(1); },
  };
}
