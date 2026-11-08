import { useSyncExternalStore } from 'react';
import { addEvent, type SafetyEvent } from './store.ts';
import { validEvent } from './storage-validation.ts';

// Bounded scalar/text-only recovery across SPA navigation; never replace damaged storage.
let pending: SafetyEvent[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const unload = (event: BeforeUnloadEvent) => {
  if (pending.length) { event.preventDefault(); event.returnValue = ''; }
};
const subscribe = (fn: () => void) => {
  if (!listeners.size) window.addEventListener('beforeunload', unload);
  listeners.add(fn);
  return () => { listeners.delete(fn); if (!listeners.size) window.removeEventListener('beforeunload', unload); };
};
export const getPendingChecks = () => pending;
export const usePendingChecks = () => useSyncExternalStore(subscribe, getPendingChecks);
export function saveCheck(event: SafetyEvent): boolean {
  if (!validEvent(event) || !event.decision) return false;
  if (addEvent(event)) return true;
  if (pending.length < 50 && !pending.some((p) => p.decision?.sessionId === event.decision!.sessionId &&
      p.decision.episodes.some((id) => event.decision!.episodes.includes(id)))) { pending = [...pending, event]; emit(); }
  return false;
}
export function retryCheck(id: string): boolean {
  const event = pending.find((e) => e.id === id);
  if (!event || !addEvent(event)) return false;
  pending = pending.filter((e) => e.id !== id); emit(); return true;
}
