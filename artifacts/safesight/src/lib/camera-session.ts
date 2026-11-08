import { waitFor } from './async.ts';

export type CameraStatus = 'idle' | 'requesting' | 'running' | 'error';
export type CameraState = { status: CameraStatus; error: string | null; dims: { w: number; h: number } | null };
export const IDLE_CAMERA: CameraState = { status: 'idle', error: null, dims: null };
const releaseStream = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());

function describe(err: unknown) {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied. Allow camera access in browser site settings, then retry.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable camera was found. Connect a camera or try another facing mode.';
  if (name === 'NotReadableError') return 'The camera may be in use by another application. Close it there and retry.';
  return err instanceof Error ? err.message : 'Camera could not start. Retry or use simulation.';
}

export function createCameraSession(options: {
  video: () => HTMLVideoElement | null;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  publish: (state: CameraState) => void;
  permissionTimeoutMs?: number;
  videoTimeoutMs?: number;
}) {
  let epoch = 0;
  let active: AbortController | null = null;
  let stream: MediaStream | null = null;
  let removeEnded = () => {};
  const release = () => {
    active?.abort(); active = null;
    removeEnded(); removeEnded = () => {};
    if (stream) releaseStream(stream);
    stream = null;
    const video = options.video();
    if (video) { video.pause(); video.srcObject = null; }
  };
  const stop = (publish = true) => {
    epoch++; release();
    if (publish) options.publish(IDLE_CAMERA);
  };
  const start = async (facingMode: 'user' | 'environment') => {
    stop(false);
    const session = epoch;
    const abort = new AbortController();
    active = abort;
    const current = () => epoch === session && !abort.signal.aborted;
    options.publish({ status: 'requesting', error: null, dims: null });
    try {
      const acquisition = options.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      // getUserMedia itself is not cancellable. Release a late grant, including after timeout.
      void acquisition.then((late) => { if (!current()) releaseStream(late); }, () => {});
      const acquired = await waitFor(acquisition, abort.signal, options.permissionTimeoutMs ?? 45000, 'Camera permission request');
      if (!current()) { releaseStream(acquired); return false; }
      stream = acquired;
      const video = options.video();
      if (!video) throw new Error('Camera video element is unavailable. Reopen the monitor and retry.');
      video.srcObject = acquired; video.muted = true; video.playsInline = true;
      const metadata = new Promise<void>((resolve, reject) => {
        const clean = () => {
          video.removeEventListener('loadedmetadata', ready);
          video.removeEventListener('error', failed);
          abort.signal.removeEventListener('abort', cancelled);
        };
        const ready = () => { clean(); resolve(); };
        const failed = () => { clean(); reject(new Error('Camera video could not load. Retry the camera.')); };
        const cancelled = () => { clean(); reject(new DOMException('Cancelled', 'AbortError')); };
        video.addEventListener('loadedmetadata', ready);
        video.addEventListener('error', failed);
        abort.signal.addEventListener('abort', cancelled, { once: true });
        if (video.readyState >= 1) ready();
      });
      await waitFor(metadata, abort.signal, options.videoTimeoutMs ?? 15000, 'Camera video');
      if (!current()) return false;
      await waitFor(video.play(), abort.signal, options.videoTimeoutMs ?? 15000, 'Camera playback');
      if (!current()) return false;
      if (!video.videoWidth || !video.videoHeight) throw new Error('Camera returned an empty frame. Retry or select another camera.');
      const ended = () => {
        if (!current()) return;
        release();
        options.publish({ status: 'error', error: 'The camera disconnected or stopped. Reconnect it and retry.', dims: null });
      };
      const interrupted = () => {
        if (!current()) return;
        release();
        options.publish({ status: 'error', error: 'The camera was interrupted and stopped supplying video. Check browser camera access, then restart.', dims: null });
      };
      acquired.getVideoTracks().forEach((track) => track.addEventListener('ended', ended));
      acquired.getVideoTracks().forEach((track) => track.addEventListener('mute', interrupted));
      removeEnded = () => acquired.getVideoTracks().forEach((track) => {
        track.removeEventListener('ended', ended); track.removeEventListener('mute', interrupted);
      });
      if (acquired.getVideoTracks().some((track) => track.readyState === 'ended' || track.muted)) {
        interrupted(); return false;
      }
      options.publish({ status: 'running', error: null, dims: { w: video.videoWidth, h: video.videoHeight } });
      return true;
    } catch (error) {
      if (!current()) return false;
      release();
      options.publish({ status: 'error', error: describe(error), dims: null });
      return false;
    }
  };
  return { start, stop };
}
