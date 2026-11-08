import { useSyncExternalStore } from 'react';
import { addEvent, type SafetyEvent } from './store.ts';

// In-memory only: preserve failed saves across SPA navigation, never overwrite damaged storage.
const pending = new Map<string, SafetyEvent>();
let snapshot: SafetyEvent[] = [];
const listeners = new Set<() => void>();
function emit() { snapshot = [...pending.values()]; listeners.forEach((l) => l()); }
const unload = (event: BeforeUnloadEvent) => { if (snapshot.length) { event.preventDefault(); event.returnValue = ''; } };
const subscribe = (listener: () => void) => {
  if (!listeners.size) window.addEventListener('beforeunload', unload);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('beforeunload', unload); };
};
export const getPendingZoneFlags = () => snapshot;
export const useZoneOutbox = () => useSyncExternalStore(subscribe, getPendingZoneFlags);
export function queueZoneFlag(event: SafetyEvent) {
  if (event.kind !== 'zone' || !event.zone) return;
  pending.set(event.zone.episodeId, event); emit();
}
export function retryZoneFlag(episodeId: string): boolean {
  const event = pending.get(episodeId);
  if (!event || !addEvent(event)) return false;
  pending.delete(episodeId); emit(); return true;
}
