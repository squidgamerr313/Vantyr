/** CPU pose inference still uses WebGL2 to prepare browser images in MediaPipe. */
export function assertPoseImageSupport(createCanvas = () => document.createElement('canvas')) {
  const probe = createCanvas();
  const gl = probe.getContext('webgl2');
  if (!gl) throw new Error('Local pose image processing requires WebGL2, even with CPU inference. Try a browser with WebGL2 enabled or use the labeled simulation. No live assessment is available.');
  try { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  finally { probe.width = probe.height = 0; }
}
