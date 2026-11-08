import type { SpeechCategory, SpeechReview } from '@workspace/api-client-react';

export const LOCAL_SPEECH_LIMITATIONS = 'Experimental English transcription plus literal phrase rules, not abuse or intent recognition. Quotes, jokes, negation, noise, accents and chunk boundaries can cause false or missed cues. No speaker identification. Human verification required.';

/** An energy gate only: not a claim that a human voice is present. */
export function hasAudibleSignal(samples: Float32Array): boolean {
  let active = 0;
  for (let offset = 0; offset + 320 <= samples.length; offset += 320) {
    let energy = 0;
    for (let i = offset; i < offset + 320; i++) energy += samples[i] ** 2;
    if (Math.sqrt(energy / 320) >= .008) active++;
  }
  return active >= 6;
}

const RULES: Array<{ category: SpeechCategory; pattern: RegExp; explanation: string }> = [
  { category: 'help_request', pattern: /\b(help me|help us|please help|call (?:an ambulance|the police)|i need help|leave me alone|stop hurting me)\b/i,
    explanation: 'A literal help-request phrase matched the local transcript. Check the speaker and context.' },
  { category: 'possible_threat', pattern: /\b(i(?:'m| am) going to|i(?:'ll| will)) (?:kill|hurt|hit|stab|shoot) (?:you|him|her|them)\b/i,
    explanation: 'An explicit harm phrase matched the local transcript. Quotation, negation and actual intent are not resolved.' },
  { category: 'possible_abuse', pattern: /\byou(?:'re| are) (?:worthless|pathetic|an idiot|stupid)\b/i,
    explanation: 'A narrow directed-insult phrase matched. This does not establish abuse or identify a target.' },
  { category: 'profanity', pattern: /\b(fuck(?:ing)?|shit|asshole|bitch)\b/i,
    explanation: 'A word on the local profanity list matched. Profanity alone is not danger.' },
];

export function reviewLocalTranscript(text: string, selected: SpeechCategory[]): SpeechReview {
  const transcript = text.replace(/\s+/g, ' ').trim().slice(0, 1200);
  const cues: SpeechReview['cues'] = [];
  for (const rule of RULES) {
    if (!selected.includes(rule.category)) continue;
    const match = rule.pattern.exec(transcript);
    if (match) cues.push({ category: rule.category, excerpt: transcript.slice(Math.max(0, match.index - 45), match.index + match[0].length + 45).slice(0, 220), explanation: rule.explanation });
  }
  return { status: transcript ? 'reviewed' : 'unintelligible', transcript, cues, limitations: LOCAL_SPEECH_LIMITATIONS };
}

/** Strictly bounded decoded PCM, copied before the session wipes its WAV buffer. */
export function decodeLocalWav(bytes: Uint8Array): Float32Array {
  if (bytes.length < 44 || (bytes.length - 44) % 2) throw new Error('Invalid PCM');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = (bytes.length - 44) / 2;
  if (count < 8000 || count > 128000 || view.getUint32(24, true) !== 16000 || view.getUint16(22, true) !== 1) throw new Error('Unsupported PCM');
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  return samples;
}
