import { waitFor } from './async.ts';

/** A backend is runtime-global in TFJS. Do not overlap model sessions on restart. */
export function createVisionLease() {
  let draining: Promise<void> | null = null;
  return async (signal: AbortSignal) => {
    while (draining) {
      await waitFor(draining, signal, 60000, 'Previous local model cleanup');
      signal.throwIfAborted();
    }
    signal.throwIfAborted();
    let finish!: () => void;
    draining = new Promise<void>(resolve => { finish = resolve; });
    let released = false;
    return () => {
      if (released) return;
      released = true; draining = null; finish();
    };
  };
}

/** One TFJS backend owner across live monitoring and optional calibration. */
export const acquireVisionModels = createVisionLease();

/** Model calls cannot all be cancelled. The single owned call must settle before cleanup. */
export function createOwnedInference<T, A extends unknown[] = []>(options: {
  run: (...args: A) => Promise<T>;
  release: () => void;
}) {
  let busy = false, disposed = false, released = false;
  const release = () => {
    if (released) return;
    released = true; options.release();
  };
  return {
    async detect(...args: A) {
      if (disposed) throw new Error('Vision engine has stopped');
      if (busy) throw new Error('An inference is already running');
      busy = true;
      try {
        const value = await options.run(...args);
        if (disposed) throw new Error('Vision engine has stopped');
        return value;
      } finally { busy = false; if (disposed) release(); }
    },
    dispose() { disposed = true; if (!busy) release(); },
    assertCurrent() { if (disposed) throw new Error('Vision engine has stopped'); },
  };
}
