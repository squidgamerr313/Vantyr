/** Settle pending browser operations on cancellation/deadline, removing all listeners. */
export function waitFor<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { clean(); reject(new DOMException('Operation cancelled', 'AbortError')); };
    // Attach both handlers even if already aborted, so a late rejection is consumed.
    promise.then((value) => { clean(); resolve(value); }, (error: unknown) => { clean(); reject(error); });
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { clean(); reject(new Error(`${label} timed out. Retry or switch to simulation.`)); }, timeoutMs);
  });
}

/** Unlike racing a timeout promise, cancellation also removes the scheduled timer. */
export function waitForDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
