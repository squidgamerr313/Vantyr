/**
 * Synchronous copy before any await: object and pose must inspect the same pixels.
 * The caller owns this canvas until both stages settle; never resize/reuse it in flight.
 */
export function captureOwnedFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, frameTimeMs: number) {
  const source = video.srcObject;
  if (!source || video.readyState < 2 || !video.videoWidth || !video.videoHeight || !Number.isFinite(frameTimeMs))
    throw new Error('Waiting for decoded camera frames');
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Local frame capture is unavailable in this browser');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { image: canvas, width: canvas.width, height: canvas.height, frameTimeMs, source,
    assertSource() {
      if (video.srcObject !== source || video.videoWidth !== canvas.width || video.videoHeight !== canvas.height)
        throw new Error('Camera source changed during inference');
    } };
}
