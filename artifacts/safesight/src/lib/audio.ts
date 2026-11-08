let context: AudioContext | null = null;
let sounding = false;
/** Reuse the context explicitly resumed by the operator's Enable/Test gesture. */
export const armedAudioContext = () => context;
export async function armAudio(): Promise<string | null> {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return 'Audio alerts are unavailable in this browser. Visual alerts remain active.';
    if (!context || context.state === 'closed') context = new Ctx();
    await context.resume();
    if (context.state !== 'running') return 'Audio is blocked by the browser. Toggle audio alerts here to enable them.';
    return null;
  } catch { return 'Audio could not be enabled. Visual alerts remain active; toggle audio to retry.'; }
}
export async function playAlert(): Promise<string | null> {
  const error = await armAudio();
  if (error || !context) return error;
  if (sounding) return null;
  sounding = true;
  try {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.2, context.currentTime + .02);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .4);
    oscillator.connect(gain).connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); sounding = false; };
    oscillator.start(); oscillator.stop(context.currentTime + .45);
    return null;
  } catch { sounding = false; return 'Audio playback failed. Visual alerts remain active.'; }
}
