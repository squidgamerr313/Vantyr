import { Router, type IRouter } from 'express';
import { ReviewSpeechBody } from '@workspace/api-zod';
import { generateSpeech, parseSpeechReview, validSpeechWav, isSpeechSilence, type SpeechGenerate } from '../lib/speech-review';

export function createSpeechRouter(options: { generate?: SpeechGenerate; now?: () => number; deadlineMs?: number; backoffMs?: number } = {}): IRouter {
  const router = Router(), recent = new Map<string, number>();
  let active = 0;
  const generate = options.generate ?? generateSpeech, now = options.now ?? Date.now;
  router.post('/speech/review', async (req, res): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Cross-site speech requests are not allowed.' }); return; }
    const input = ReviewSpeechBody.strict().safeParse(req.body);
    if (!input.success || !validSpeechWav(input.data.audio) || new Set(input.data.categories).size !== input.data.categories.length) {
      res.status(400).json({ error: 'Provide consented mono 16kHz PCM WAV audio, 0.5–8 seconds, with enabled categories.' }); return;
    }
    const time = now(), key = req.ip ?? 'unknown';
    for (const [ip, at] of recent) if (time - at >= 60000) recent.delete(ip);
    if (active >= 2 || (recent.has(key) && time - recent.get(key)! < 7000) || (!recent.has(key) && recent.size >= 1000)) {
      res.setHeader('Retry-After', '7'); res.status(429).json({ error: 'Speech review capacity reached. Stop and start again with consent later.' }); return;
    }
    recent.set(key, time); active++;
    if (isSpeechSilence(input.data.audio)) {
      active--;
      res.json({ status: 'silence', transcript: '', cues: [], limitations: 'Digital silence / very low signal only. This is not evidence of safety; quiet speech may be missed. Human verification is required.' });
      return;
    }
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const task = (async () => {
      for (let attempt = 0; ; attempt++) {
        controller.signal.throwIfAborted();
        try { return parseSpeechReview(await generate(input.data.audio, input.data.categories, controller.signal), input.data.categories); }
        catch (error) {
          const status = (error as { status?: number })?.status;
          if (controller.signal.aborted || attempt >= 1 || (status !== 429 && status !== 503)) throw error;
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new Error('Cancelled')); };
            const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, options.backoffMs ?? 500);
            controller.signal.addEventListener('abort', abort, { once: true });
          });
        }
      }
    })();
    // Keep capacity reserved until the actual provider settles, even if it ignores cancellation.
    void task.finally(() => { active--; }).catch(() => {});
    try {
      const result = await Promise.race([task, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => { controller.abort(); reject(new Error('Deadline')); }, options.deadlineMs ?? 22000);
      })]);
      if (!controller.signal.aborted && !res.destroyed) res.json(result);
    } catch {
      // No audio, transcript, cue, provider error or validation details in logs/telemetry.
      if (!res.destroyed) res.status(503).json({ error: 'Speech review unavailable. Capture must be restarted with new consent. Camera monitoring can continue.' });
    } finally { clearTimeout(deadline); res.off('close', onClose); }
  });
  return router;
}
export default createSpeechRouter();
