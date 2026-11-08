import { useSyncExternalStore } from 'react';
import { parseEvents, parsePrefs, validEvent } from './storage-validation.ts';
import { createDemoEvents } from './demo-events.ts';
import type { MotionEvidence } from './motion-evidence.ts';
import { nextReview, type ZoneRecord, type ZoneReview, type ReviewAction, type ReviewOptions } from './zone-records.ts';

export type RiskLevel = 'low' | 'moderate' | 'high';
export type Source = 'live' | 'demo';

export interface SafetyEvent {
  id: string;
  ts: number;
  source: Source;
  kind: 'risk' | 'analysis' | 'zone';
  level: RiskLevel | 'uncertain';
  score: number | null;
  evidence: string[];
  detections: number;
  summary?: string;
  recommendations?: string[];
  limitations?: string;
  motion?: MotionEvidence;
  decision?: import('./context-decision.ts').ContextDecision;
  zone?: ZoneRecord;
  review?: ZoneReview;
}

export interface Preferences {
  facingMode: 'user' | 'environment';
  minConfidence: number;
  intervalMs: number;
  showBoxes: boolean;
  showPose: boolean;
  audioAlerts: boolean;
  logThreshold: RiskLevel;
  logCooldownSec: number;
  maxEvents: number;
}

export const DEFAULT_PREFS: Preferences = {
  facingMode: 'user',
  minConfidence: 0.5,
  intervalMs: 120,
  showBoxes: true,
  showPose: true,
  audioAlerts: false,
  logThreshold: 'moderate',
  logCooldownSec: 8,
  maxEvents: 300,
};

export const STORAGE_KEYS = { events: 'safesight.events.v1', prefs: 'safesight.prefs.v1' } as const;
type StorageArea = keyof typeof STORAGE_KEYS;
export interface StorageIssue { area: StorageArea; kind: 'read' | 'invalid' | 'write'; message: string }
let issues: StorageIssue[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let noticeQueued = false;
function issue(area: StorageArea, value: Omit<StorageIssue, 'area'> | null) {
  const prev = issues.find((i) => i.area === area);
  if (prev?.kind === value?.kind && prev?.message === value?.message) return;
  issues = [...issues.filter((i) => i.area !== area), ...(value ? [{ area, ...value }] : [])];
  // Reads can occur inside React's snapshot getter; never notify synchronously there.
  if (!noticeQueued) {
    noticeQueued = true;
    queueMicrotask(() => { noticeQueued = false; emit(); });
  }
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || Object.values(STORAGE_KEYS).some((key) => key === e.key)) {
      getEvents(); getPrefs(); l();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
};

type Cache<T> = { raw?: string | null; val: T; invalid: boolean };
const evCache: Cache<SafetyEvent[]> = { val: [], invalid: false };
const prefCache: Cache<Preferences> = { val: DEFAULT_PREFS, invalid: false };
function read<T>(area: StorageArea, cache: Cache<T>, fallback: T, parse: (v: unknown) => { value: T; invalid: boolean }): T {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEYS[area]); }
  catch {
    issue(area, { kind: 'read', message: 'Browser storage is unavailable. Existing data cannot be read and changes cannot be saved.' });
    return cache.val;
  }
  if (raw !== cache.raw) {
    cache.raw = raw;
    try {
      const result = raw === null ? { value: fallback, invalid: false } : parse(JSON.parse(raw));
      cache.val = result.value; cache.invalid = result.invalid;
    } catch { cache.val = fallback; cache.invalid = true; }
  }
  if (cache.invalid) issue(area, { kind: 'invalid', message: 'Saved data contains invalid values. Usable records/default preferences are shown; the original data has not been changed. Automatic event logging and changes to this data are paused until it is restored or explicitly reset. Export it before resetting.' });
  else if (issues.some((i) => i.area === area && i.kind !== 'write')) issue(area, null);
  return cache.val;
}

const EMPTY_EVENTS: SafetyEvent[] = [];
export const getEvents = () => read('events', evCache, EMPTY_EVENTS, parseEvents);
export const getPrefs = () => read('prefs', prefCache, DEFAULT_PREFS, (v) => parsePrefs(v, DEFAULT_PREFS));

function write(area: StorageArea, v: unknown): boolean {
  try { localStorage.setItem(STORAGE_KEYS[area], JSON.stringify(v)); }
  catch {
    issue(area, { kind: 'write', message: 'Changes were not saved. Browser storage may be full or blocked. Free space or allow storage, then retry your action.' });
    return false;
  }
  issue(area, null); emit();
  return true;
}

const blocked = (area: StorageArea) => issues.some((i) => i.area === area && i.kind !== 'write');
export function addEvent(e: Omit<SafetyEvent, 'id' | 'ts'> & { ts?: number }) {
  const ev: SafetyEvent = { ...e, id: crypto.randomUUID(), ts: e.ts ?? Date.now() };
  const current = getEvents();
  if (blocked('events') || !validEvent(ev)) return null;
  const max = getPrefs().maxEvents;
  // A fallback retention limit must never trim history while preferences are damaged/unreadable.
  if (blocked('prefs')) return null;
  if (ev.kind === 'zone') {
    const existing = current.find((old) => old.kind === 'zone' && old.zone?.episodeId === ev.zone?.episodeId);
    if (existing) return existing;
  }
  if (ev.decision) {
    const existing = current.find((old) => old.source === ev.source && old.decision?.sessionId === ev.decision?.sessionId &&
      old.decision?.episodes.some((id) => ev.decision!.episodes.includes(id)));
    if (existing) return existing;
  }
  return write('events', [ev, ...current].slice(0, max)) ? ev : null;
}
/** Explicit, atomic insertion: examples must never evict or overwrite saved history. */
export function loadDemoEvents(): { added: number; error?: string } {
  const current = getEvents();
  const prefs = getPrefs();
  if (blocked('events') || blocked('prefs')) return { added: 0, error: 'Restore or reset the damaged/unavailable browser storage before loading examples. Existing data has not been changed.' };
  const ids = new Set(current.map((event) => event.id));
  const missing = createDemoEvents().filter((event) => !ids.has(event.id));
  if (!missing.length) return { added: 0 };
  if (current.length + missing.length > prefs.maxEvents) return { added: 0, error: 'There is not enough room under your history limit. Export and remove unwanted records or increase the limit in Settings; no history was changed.' };
  if (!missing.every(validEvent)) return { added: 0, error: 'The demo examples could not be validated. No history was changed.' };
  const merged = [...current, ...missing].sort((a, b) => b.ts - a.ts);
  return write('events', merged) ? { added: missing.length } : { added: 0, error: 'Examples could not be saved. Allow browser storage or free space, then retry.' };
}
export function reviewEvent(id: string, status: ReviewAction['status'], note: string, now = Date.now(), options: ReviewOptions = {}): boolean {
  const current = getEvents();
  if (blocked('events')) return false;
  const event = current.find((e) => e.id === id);
  if (!event) return false;
  // Compare the rendered/draft revision with fresh storage before applying a human action.
  if (Object.hasOwn(options, 'expectedReview') && JSON.stringify(options.expectedReview) !== JSON.stringify(event.review ?? null)) return false;
  const review = nextReview(event, status, note, now, options);
  if (!review) return false;
  const updated = { ...event, review };
  return validEvent(updated) && write('events', current.map((e) => e.id === id ? updated : e));
}
/** Retained for existing zone callers; the shared API also supports saved risk observations. */
export const reviewZoneEvent = reviewEvent;
export function deleteEvent(id: string) {
  const current = getEvents();
  return !blocked('events') && write('events', current.filter((e) => e.id !== id));
}
// Explicit user-confirmed reset is the only action allowed to replace damaged storage.
export const clearEvents = () => write('events', []);
export function setPrefs(p: Partial<Preferences>) {
  const next = parsePrefs({ ...getPrefs(), ...p }, DEFAULT_PREFS);
  return !blocked('prefs') && !next.invalid && write('prefs', next.value);
}
export const resetPrefs = () => write('prefs', DEFAULT_PREFS);
export function getOriginalStorage(area: StorageArea) {
  try { return localStorage.getItem(STORAGE_KEYS[area]); }
  catch { issue(area, { kind: 'read', message: 'Browser storage is blocked. Original data could not be exported.' }); return null; }
}
export const useStorageIssues = () => useSyncExternalStore(subscribe, () => {
  getEvents(); getPrefs();
  return issues;
});
export const useEvents = () => useSyncExternalStore(subscribe, getEvents);
export const usePrefs = () => useSyncExternalStore(subscribe, getPrefs);
