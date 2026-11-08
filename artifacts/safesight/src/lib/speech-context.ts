import type { SpeechCategory, SpeechReview } from '@workspace/api-client-react';
import { reviewLocalTranscript } from './local-speech-rules.ts';

export const SPEECH_CONTEXT_MODEL = 'Xenova/mobilebert-uncased-mnli';
export const SPEECH_CONTEXT_REVISION = '8b0ea66ab7b190bba77418ba03b67d69cfc9a1ee';
export const CONTEXT_LABELS = [
  'a direct threat to hurt another person',
  'a request for help or protection',
  'an insult directed at another person',
  'reporting, quoting or denying a threat',
  'ordinary conversation without a request for help or a threat',
] as const;
export type ContextPrediction = { labels: string[]; scores: number[] };
export const CONTEXT_LIMITATIONS = 'Experimental English transcription with generic NLI context screening and conservative phrase gates; not a trained abuse/intent detector. Model scores are not calibrated danger probabilities. Context can still be misunderstood. Quiet speech, noise, accents and chunk gaps cause misses. Human verification required.';
export type ContextualCue = SpeechReview['cues'][number] & { contextStatus?: 'supported' | 'uncertain'; automaticResponseEligible?: boolean };
export type ContextualReview = Omit<SpeechReview, 'cues'> & { cues: ContextualCue[] };
const LABEL: Partial<Record<SpeechCategory, string>> = {
  possible_threat: CONTEXT_LABELS[0], help_request: CONTEXT_LABELS[1], possible_abuse: CONTEXT_LABELS[2],
};
/** Fail closed on obvious reporting/quotation/negation before any model score.
 * This intentionally sacrifices recall; it does not claim full language parsing. */
export function reportedOrNegated(text: string) {
  return /["“”]|\b(?:said|says|told|quoted|quoting|jok(?:e|ing)|movie|lyrics|pretend|hypothetical|not|never|won't|wouldn't|don't|didn't)\b/i.test(text);
}
export function contextualSpeechReview(text: string, context: string, selected: SpeechCategory[], prediction: ContextPrediction): ContextualReview {
  const literal = reviewLocalTranscript(text, selected);
  const cues: ContextualCue[] = [];
  const sorted = prediction.labels.map((label, i) => ({ label, score: prediction.scores[i] })).sort((a, b) => b.score - a.score);
  const valid = prediction.labels.length === CONTEXT_LABELS.length &&
    new Set(prediction.labels).size === CONTEXT_LABELS.length &&
    CONTEXT_LABELS.every(label => prediction.labels.includes(label)) &&
    prediction.scores.length === prediction.labels.length && prediction.scores.every(n => Number.isFinite(n) && n >= 0 && n <= 1);
  for (const cue of literal.cues) {
    if (cue.category === 'profanity') { cues.push({ ...cue, automaticResponseEligible: false }); continue; }
    if (reportedOrNegated(context)) continue;
    // A clear task qualifier is a conservative negative control, not a broad
    // semantic guarantee. Generic NLI confuses everyday help with safety help.
    if (cue.category === 'help_request' && /\b(homework|assignment|recipe|spreadsheet|math|coding|computer|website)\b/i.test(context)) continue;
    // Single top hypothesis plus a margin, with a literal cue in the CURRENT
    // chunk. Old context alone can never replay a previously observed threat.
    const supported = valid && sorted[0]?.label === LABEL[cue.category] && sorted[0].score >= .75 && sorted[0].score - (sorted[1]?.score ?? 1) >= .2;
    cues.push({ ...cue, contextStatus: supported ? 'supported' : 'uncertain',
      automaticResponseEligible: supported && (cue.category === 'help_request' || cue.category === 'possible_threat'),
      explanation: supported
        ? 'A current phrase matched and the local context model favored the corresponding hypothesis. Still an uncertain review cue, not established intent.'
        : 'A current phrase matched, but the context model is uncertain or disagrees. Human review only; this cue cannot automatically trigger responses.' });
  }
  return { ...literal, cues, limitations: CONTEXT_LIMITATIONS };
}

/** At most three chunks/600 characters; reset across processing/outage gaps. */
export function createSpeechContext() {
  let chunks: string[] = [], last = -Infinity;
  return {
    add(text: string, now: number) {
      if (now < last || now - last > 15000) chunks = [];
      last = now; chunks = [...chunks, text.trim().slice(0, 250)].slice(-3);
      return chunks.join(' ').slice(-600);
    },
    clear() { chunks = []; last = -Infinity; },
  };
}
