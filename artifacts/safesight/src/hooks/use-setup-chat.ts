import { useEffect, useRef, useState } from 'react';
import { askSetupAssistant } from '@workspace/api-client-react';
import { GUIDE, pickSetupSettings, validSetupPatch, type SetupPatch, type SetupSettings } from '@workspace/safesight-guide';
import { getPrefs, setPrefs, usePrefs } from '@/lib/store';
import { changedValues, previousValues, proposalConflicts } from '@/lib/setup-changes';

export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; sources?: string[] }
export interface ConfigProposal { reason: string; changes: SetupPatch; before: SetupSettings }

export function useSetupChat() {
  const prefs = usePrefs();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposal, setProposal] = useState<ConfigProposal | null>(null);
  const [undo, setUndo] = useState<{ before: SetupPatch; after: SetupSettings } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; active.current?.abort(); }, []);
  const clear = () => {
    sequence.current++; active.current?.abort(); active.current = null;
    setMessages([]); setProposal(null); setPending(false); setError(null); setStatus(null);
    // Keep a pending undo available: clearing chat does not silently discard a recovery action.
  };
  const send = async (raw: string) => {
    const content = raw.trim();
    if (!content || content.length > 2000 || active.current) return false;
    const id = ++sequence.current;
    const controller = new AbortController(); active.current = controller;
    const before = pickSetupSettings(getPrefs());
    const next = [...messages, { id: crypto.randomUUID(), role: 'user' as const, content }].slice(-24);
    setMessages(next); setProposal(null); setPending(true); setError(null); setStatus(null);
    try {
      const result = await askSetupAssistant({
        messages: next.slice(-11).map(({ role, content: text }) => ({ role, content: text.slice(0, 2000) })),
        settings: before,
      }, { signal: controller.signal });
      if (sequence.current !== id) return false;
      if (!result.answer || !Array.isArray(result.sources) || !result.sources.length ||
        result.sources.some(source => !GUIDE.some(article => article.id === source)) ||
        (result.proposal && !validSetupPatch(result.proposal.changes))) throw new Error('Invalid assistant answer');
      setMessages(previous => [...previous, {
        id: crypto.randomUUID(), role: 'assistant' as const, content: result.answer, sources: result.sources,
      }].slice(-24));
      if (result.proposal) {
        const changes = changedValues(before, result.proposal.changes);
        if (Object.keys(changes).length) setProposal({ reason: result.proposal.reason, changes, before });
        else setStatus('The suggested preferences already match this browser. Nothing changed.');
      }
      return true;
    } catch (failure) {
      if (sequence.current !== id || controller.signal.aborted) return false;
      const code = (failure as { status?: number }).status;
      setError(code === 429 ? 'The assistant is busy or you have sent several messages. Wait a minute and try again. Nothing changed.' :
        'The assistant is unavailable. Nothing changed. You can try again, read the docs, or use Settings manually.');
      return false;
    } finally {
      if (sequence.current === id) { active.current = null; setPending(false); }
    }
  };
  const apply = () => {
    if (!proposal) return;
    const current = pickSetupSettings(getPrefs());
    if (proposalConflicts(current, proposal.before, proposal.changes)) {
      setStatus('These preferences changed after the proposal was prepared. Ask for a fresh proposal; nothing was overwritten.');
      setProposal(null); return;
    }
    const before = previousValues(current, proposal.changes);
    if (!setPrefs(proposal.changes)) { setStatus('Not saved. Check the storage notice and retry. Your previous preferences remain in place.'); return; }
    setUndo({ before, after: pickSetupSettings(getPrefs()) });
    setProposal(null);
    setStatus('Applied to this browser only. Camera facing applies on the next camera start. No camera was opened and no snapshot was sent.');
  };
  const undoChanges = () => {
    if (!undo) return;
    if (proposalConflicts(pickSetupSettings(getPrefs()), undo.after, undo.before)) {
      setStatus('Some of these preferences were edited again. Undo stopped to avoid overwriting newer changes. Use Settings to review them.'); return;
    }
    if (!setPrefs(undo.before)) { setStatus('Undo was not saved. Check the storage notice and retry.'); return; }
    setUndo(null); setProposal(null); setStatus('Previous preferences restored in this browser.');
  };
  return {
    messages, proposal, pending, error, status, prefs: pickSetupSettings(prefs),
    canUndo: !!undo, send, clear, apply, undoChanges,
    dismiss: () => { setProposal(null); setStatus('Proposal dismissed. Nothing changed.'); },
  };
}
