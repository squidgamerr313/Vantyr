import { useEffect, useRef, useState } from 'react';
import type { SpeechCategory } from '@workspace/api-client-react';
import { bindSpeechLifecycle, createSpeechSession, DEFAULT_SPEECH_CATEGORIES, STOPPED_SPEECH } from '@/lib/speech-session';
import { captureSpeech } from '@/lib/speech-capture';
import { createLocalSpeechClient } from '@/lib/local-speech-client';

export function useSpeechReview() {
  const [state, setState] = useState(STOPPED_SPEECH);
  const [categories, setCategories] = useState<SpeechCategory[]>([...DEFAULT_SPEECH_CATEGORIES]);
  const session = useRef<ReturnType<typeof createSpeechSession> | null>(null);
  if (!session.current) {
    const local = createLocalSpeechClient(() => new Worker(new URL('../lib/local-speech.worker.ts', import.meta.url), { type: 'module' }));
    session.current = createSpeechSession({
    acquire: () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !AudioContext.prototype.createScriptProcessor) return Promise.reject(new Error('Unsupported capture'));
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    },
    capture: captureSpeech, publish: setState, visible: () => document.visibilityState === 'visible',
    prepare: local.prepare, release: local.close, review: local.review,
    reviewMs: 20000,
    });
  }
  useEffect(() => {
    const audio = () => session.current?.stop('Speech stopped before response audio to prevent feedback. Restart only with fresh consent.');
    window.addEventListener('vantyr:response-audio', audio);
    const unbind = bindSpeechLifecycle(document, window, (...args) => session.current?.stop(...args));
    return () => { window.removeEventListener('vantyr:response-audio', audio); unbind(); };
  }, []);
  return { state, categories,
    setCategories: (next: SpeechCategory[]) => { session.current?.stop(); setCategories(next); },
    start: () => session.current?.start(categories),
    stop: () => session.current?.stop('Stopped. Microphone released; local audio, transcript and cues cleared.'),
    dismiss: (id: string) => session.current?.dismiss(id) };
}
