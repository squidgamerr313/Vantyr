import { RESPONSE_NOTICE } from './responses';
import { armedAudioContext } from './audio';

/** Bounded moderate-volume tone, with actual cancellation of scheduled audio. */
export async function responseTone(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('Cancelled');
  const context = armedAudioContext();
  if (!context || context.state !== 'running' || signal.aborted) throw new Error('Audio blocked');
  await new Promise<void>((resolve, reject) => {
      const tone = context.createOscillator(), gain = context.createGain();
      const abort = () => { tone.stop(); tone.disconnect(); gain.disconnect(); reject(new Error('Cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      tone.frequency.value = 660;
      gain.gain.value = .08;
      tone.connect(gain).connect(context.destination);
      tone.onended = () => { signal.removeEventListener('abort', abort); tone.disconnect(); gain.disconnect(); resolve(); };
      tone.start(); tone.stop(context.currentTime + .65);
  });
}

/** Local voices only: never silently send notification text to a vendor voice. */
export function responseSpoken(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || !('speechSynthesis' in window)) { reject(new Error('Local speech unavailable')); return; }
    const voice = speechSynthesis.getVoices().find(v => v.localService && /^en\b/i.test(v.lang));
    if (!voice) { reject(new Error('No local English voice available')); return; }
    const utterance = new SpeechSynthesisUtterance(RESPONSE_NOTICE);
    utterance.voice = voice; utterance.volume = .6;
    const abort = () => { speechSynthesis.cancel(); reject(new Error('Cancelled')); };
    const clean = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    utterance.onend = () => { clean(); resolve(); };
    utterance.onerror = () => { clean(); reject(new Error('Local speech blocked')); };
    speechSynthesis.speak(utterance);
  });
}
