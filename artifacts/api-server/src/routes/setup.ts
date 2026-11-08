import { Router, type IRouter } from 'express';
import { AskSetupAssistantBody, AskSetupAssistantResponse } from '@workspace/api-zod';
import { GUIDE, SETUP_KEYS, validSetupPatch } from '@workspace/safesight-guide';
import { generateSetupAnswer, type SetupChatInput } from '../lib/setup-assistant';

const inputSchema = AskSetupAssistantBody.strict().extend({
  messages: AskSetupAssistantBody.shape.messages.element.strict().array().min(1).max(12),
  settings: AskSetupAssistantBody.shape.settings.strict(),
});
const outputSchema = AskSetupAssistantResponse.strict().extend({
  proposal: AskSetupAssistantResponse.shape.proposal.unwrap().strict().extend({
    changes: AskSetupAssistantResponse.shape.proposal.unwrap().shape.changes.strict(),
  }).optional(),
});

/** Stateless: no conversation, preference, event or image persistence on the server. */
export function createSetupRouter(options: {
  generate?: (input: SetupChatInput) => Promise<string | undefined>;
  now?: () => number;
} = {}): IRouter {
  const router = Router();
  const recent = new Map<string, { started: number; count: number }>();
  const generate = options.generate ?? generateSetupAnswer;
  const now = options.now ?? Date.now;
  let active = 0;
  router.post('/setup/chat', async (req, res): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.get('origin');
    let sameOrigin = true;
    if (origin) {
      try { sameOrigin = new URL(origin).host === req.get('host'); } catch { sameOrigin = false; }
    }
    if (req.get('sec-fetch-site') === 'cross-site' || !sameOrigin) {
      res.status(403).json({ error: 'Cross-site assistant requests are not allowed.' }); return;
    }
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.messages.at(-1)?.role !== 'user' ||
      !validSetupPatch(parsed.data.settings) || SETUP_KEYS.some(key => !Object.hasOwn(parsed.data.settings, key))) {
      res.status(400).json({ error: 'Send up to 12 messages of 2000 characters and the supported local preferences only.' }); return;
    }
    const time = now();
    for (const [key, value] of recent) if (time - value.started >= 60000) recent.delete(key);
    const key = req.ip ?? 'unknown';
    const count = recent.get(key);
    if (active >= 2 || (count?.count ?? 0) >= 12 || (!count && recent.size >= 2000)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'The assistant is busy. Wait a minute before trying again.' }); return;
    }
    recent.set(key, { started: count?.started ?? time, count: (count?.count ?? 0) + 1 });
    active++;
    try {
      const raw = JSON.parse(await generate(parsed.data) ?? '{}') as unknown;
      const result = outputSchema.parse(raw);
      if (result.sources.some(source => !GUIDE.some(article => article.id === source)) ||
        (result.proposal && !validSetupPatch(result.proposal.changes))) throw new Error('Invalid response');
      if (!res.destroyed) res.json({ ...result, sources: [...new Set(result.sources)] });
    } catch {
      // Never log typed messages, settings, provider error bodies or returned prose.
      req.log.warn('Setup assistant unavailable or returned an invalid answer');
      if (!res.destroyed) res.status(503).json({ error: 'The assistant is unavailable. Nothing changed. Read the docs or try again.' });
    } finally { active--; }
  });
  return router;
}

export default createSetupRouter();
