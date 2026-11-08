import type { SafetyEvent, Source } from './store.ts';

export type ZoneRect = [number, number, number, number];
export interface ZoneConfig { id: string; name: string; rect: ZoneRect; dwellSec: number }
export interface ZoneRecord {
  version: 'zone-v1';
  sessionId: string;
  sessionStartedAt: number;
  episodeId: string;
  zone: ZoneConfig;
  personId: string;
  personLabel: string;
  dwellMs: number;
  timestampBasis: 'decoded-video' | 'simulation';
}
export type ReviewStatus = 'open' | 'reviewed' | 'resolved' | 'dismissed';
export type HumanOutcome = 'assistance-needed' | 'no-assistance-needed' | 'unable-to-verify';
export interface ReviewAction { status: Exclude<ReviewStatus, 'open'>; at: number; note: string; outcome?: HumanOutcome; confirmed?: true }
export interface ZoneReview { status: ReviewStatus; actions: ReviewAction[] }
export const MAX_REVIEW_NOTE = 1000;
export const MAX_REVIEW_ACTIONS = 1000;
export const HUMAN_OUTCOMES: HumanOutcome[] = ['assistance-needed', 'no-assistance-needed', 'unable-to-verify'];
export const reviewOutcome = (review?: ZoneReview): HumanOutcome | undefined =>
  review?.actions.findLast((a) => a.outcome !== undefined)?.outcome;
export interface ReviewOptions { outcome?: HumanOutcome; confirmed?: boolean; expectedReview?: ZoneReview | null }
const transitions: Record<ReviewStatus, ReviewStatus[]> = {
  open: ['reviewed', 'dismissed'], reviewed: ['reviewed', 'resolved', 'dismissed'], resolved: [], dismissed: [],
};
export const canReview = (from: ReviewStatus, to: ReviewStatus) => transitions[from]?.includes(to) ?? false;
export function nextReview(event: SafetyEvent, status: ReviewAction['status'], note: string, now: number, options: ReviewOptions = {}): ZoneReview | null {
  const review = event.review ?? { status: 'open', actions: [] };
  const outcome = options.outcome ?? reviewOutcome(review);
  if (!['risk', 'zone'].includes(event.kind) || !canReview(review.status, status) || review.actions.length >= MAX_REVIEW_ACTIONS ||
      (options.outcome !== undefined && !HUMAN_OUTCOMES.includes(options.outcome)) ||
      (status === 'resolved' && (options.confirmed !== true || outcome === 'unable-to-verify')) ||
      typeof note !== 'string' || note.length > MAX_REVIEW_NOTE || !Number.isFinite(now) || now < 0 || now > 8.64e15) return null;
  return { status, actions: [...review.actions, { status, note: note.trim(), at: Math.max(now, event.ts, review.actions.at(-1)?.at ?? 0),
    ...(options.outcome !== undefined ? { outcome: options.outcome } : {}),
    ...(status === 'resolved' ? { confirmed: true as const } : {}) }] };
}
export interface ZoneSessionSummary {
  id: string; source: Source; startedAt: number; total: number; open: number; reviewed: number; resolved: number; dismissed: number; notRecorded: number;
  meanFirstReviewMs: number | null;
}
/** Summaries describe retained records, not lifetime counts or verified safe conditions. */
export function summarizeZoneSessions(events: SafetyEvent[]): ZoneSessionSummary[] {
  const groups = new Map<string, { summary: ZoneSessionSummary; delays: number[] }>();
  for (const event of events) {
    if (event.kind !== 'zone' || !event.zone) continue;
    const key = `${event.source}:${event.zone.sessionId}`;
    let group = groups.get(key);
    if (!group) {
      group = { summary: { id: event.zone.sessionId, source: event.source, startedAt: event.zone.sessionStartedAt, total: 0, open: 0, reviewed: 0, resolved: 0, dismissed: 0, notRecorded: 0, meanFirstReviewMs: null }, delays: [] };
      groups.set(key, group);
    }
    group.summary.total++; group.summary[event.review?.status ?? 'notRecorded']++;
    const first = event.review?.actions[0];
    if (first) group.delays.push(Math.max(0, first.at - event.ts));
  }
  return [...groups.values()].map(({ summary, delays }) => ({
    ...summary, meanFirstReviewMs: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
  })).sort((a, b) => b.startedAt - a.startedAt);
}
