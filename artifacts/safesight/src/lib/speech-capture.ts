import type { SpeechCaptureFactory } from './speech-session.ts';

/** Bounded PCM capture, not browser/vendor speech recognition. No audio playback. */
export const captureSpeech: SpeechCaptureFactory = async (stream, chunk, failed) => {
  if (!window.AudioContext || !AudioContext.prototype.createScriptProcessor) throw new Error('PCM capture unsupported');
  // Let Web Audio resample microphone input, rather than dropping high-rate
  // samples without an anti-alias filter in application code.
  const context = new AudioContext({ sampleRate: 16000 });
  let closed = false;
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const gain = context.createGain(); gain.gain.value = 0;
  let samples = new Float32Array(48000), count = 0;
  const close = () => {
    if (closed) return; closed = true;
    processor.onaudioprocess = null; context.onstatechange = null;
    source.disconnect(); processor.disconnect(); gain.disconnect();
    samples.fill(0); samples = new Float32Array(0);
    void context.close().catch(() => {});
  };
  try {
    await context.resume();
    if (context.state !== 'running' || context.sampleRate !== 16000) throw new Error('16kHz PCM capture unsupported or blocked');
    context.onstatechange = () => { if (!closed && context.state !== 'running') failed(); };
    processor.onaudioprocess = event => {
      if (closed) return;
      const input = event.inputBuffer.getChannelData(0);
      const part = input.subarray(0, samples.length - count);
      samples.set(part, count); count += part.length;
      if (count === samples.length) {
        const complete = samples;
        samples = new Float32Array(0);
        close(); chunk(complete);
      }
    };
    source.connect(processor); processor.connect(gain); gain.connect(context.destination);
    return { close };
  } catch (e) { close(); throw e; }
};
