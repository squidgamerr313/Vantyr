import type { TrackedPerson } from './person-tracking.ts';
import type { Source } from './store.ts';
import type { ZoneConfig, ZoneRect, ZoneRecord } from './zone-records.ts';

export function validZone(v: unknown): v is ZoneConfig {
  if (!v || typeof v !== 'object') return false;
  const z = v as ZoneConfig;
  return typeof z.id === 'string' && z.id.length > 0 && z.id.length <= 80 &&
    typeof z.name === 'string' && z.name.trim().length > 0 && z.name.length <= 60 &&
    Number.isInteger(z.dwellSec) && z.dwellSec >= 1 && z.dwellSec <= 60 && validRect(z.rect);
}
export function validRect(r: unknown): r is ZoneRect {
  return Array.isArray(r) && r.length === 4 && r.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    r[0] >= 0 && r[1] >= 0 && r[2] >= .02 && r[3] >= .02 && r[0] + r[2] <= 1 + 1e-9 && r[1] + r[3] <= 1 + 1e-9;
}
/** Normalized point in the contained video image; letterbox clicks are not scene coordinates. */
export function imagePoint(x: number, y: number, bounds: { left: number; top: number; width: number; height: number }, w: number, h: number): [number, number] | null {
  if (![x, y, bounds.left, bounds.top, bounds.width, bounds.height, w, h].every(Number.isFinite) || Math.min(bounds.width, bounds.height, w, h) <= 0) return null;
  const scale = Math.min(bounds.width / w, bounds.height / h);
  const left = bounds.left + (bounds.width - w * scale) / 2, top = bounds.top + (bounds.height - h * scale) / 2;
  const p: [number, number] = [(x - left) / (w * scale), (y - top) / (h * scale)];
  return p.every((n) => n >= 0 && n <= 1) ? p : null;
}
export function rectangle(a: [number, number], b: [number, number]): ZoneRect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
}
export interface ZoneOccupant { id: string; label: string; dwellMs: number; flagged: boolean; state: 'inside' | 'boundary' }
export interface ZoneProgress { status: 'off' | 'watching' | 'uncertain' | 'stale'; occupants: ZoneOccupant[] }
export interface ZoneTick {
  zone: ZoneConfig | null; sessionId: string; sessionStartedAt: number; source: Source;
  persons: TrackedPerson[]; frameTimeMs: number | undefined; now: number;
}
export const EMPTY_ZONE_PROGRESS: ZoneProgress = { status: 'off', occupants: [] };
export function createZoneMonitor() {
  let key = '', lastFrame: number | null = null, lastWall: number | null = null, lastFreshWall: number | null = null;
  let previous: ZoneProgress = EMPTY_ZONE_PROGRESS;
  const entries = new Map<string, { since: number | null; fired: boolean; flaggedMs: number }>();
  function reset() { entries.clear(); key = ''; lastFrame = lastWall = lastFreshWall = null; previous = EMPTY_ZONE_PROGRESS; }
  return {
    reset,
    tick(input: ZoneTick): ZoneProgress & { triggers: ZoneRecord[] } {
      const { zone, persons, frameTimeMs: time, now } = input;
      if (!zone || !validZone(zone)) { reset(); return { ...EMPTY_ZONE_PROGRESS, triggers: [] }; }
      const nextKey = JSON.stringify([input.source, input.sessionId, zone]);
      if (key !== nextKey) { reset(); key = nextKey; }
      if (time === undefined || !Number.isFinite(time) || time < 0 || !Number.isFinite(now)) {
        entries.clear(); lastFrame = lastWall = lastFreshWall = null;
        previous = { status: 'uncertain', occupants: [] };
        return { ...previous, triggers: [] };
      }
      if (lastFrame === time) {
        if (lastFreshWall !== null && (now - lastFreshWall > 2500 || now < lastFreshWall)) {
          entries.clear(); previous = { status: 'stale', occupants: [] };
        }
        return { ...previous, triggers: [] };
      }
      if ((lastFrame !== null && (time < lastFrame || time - lastFrame > 2500)) ||
          (lastWall !== null && (now < lastWall || now - lastWall > 2500))) entries.clear();
      lastFrame = time; lastWall = lastFreshWall = now;
      const occupants: ZoneOccupant[] = [], triggers: ZoneRecord[] = [];
      const seen = new Set<string>();
      let uncertain = false;
      for (const person of persons.slice(0, 20)) {
        if (!person.id || person.status === 'uncertain' || person.detectionIndex === null) { uncertain = true; continue; }
        const [bx, by, bw, bh] = person.box, x = bx + bw / 2, y = by + bh;
        if (![bx, by, bw, bh].every(Number.isFinite) || bw <= 0 || bh <= 0 || x < 0 || x > 1 || y < 0 || y > 1) { uncertain = true; continue; }
        const [zx, zy, zw, zh] = zone.rect;
        // Half a percent of the image is an uncertainty band, not a real-world distance.
        const margin = .005;
        const outside = x < zx - margin || x > zx + zw + margin || y < zy - margin || y > zy + zh + margin;
        if (outside) { entries.delete(person.id); continue; }
        seen.add(person.id);
        let entry = entries.get(person.id);
        if (!entry) { entry = { since: null, fired: false, flaggedMs: 0 }; entries.set(person.id, entry); }
        const boundary = x <= zx + margin || x >= zx + zw - margin || y <= zy + margin || y >= zy + zh - margin;
        if (boundary) { entry.since = null; uncertain = true; }
        else entry.since ??= time;
        const dwellMs = entry.since === null ? 0 : time - entry.since;
        if (!boundary && !entry.fired && dwellMs >= zone.dwellSec * 1000) {
          entry.fired = true; entry.flaggedMs = dwellMs;
          triggers.push({
            version: 'zone-v1', sessionId: input.sessionId, sessionStartedAt: input.sessionStartedAt,
            episodeId: `${input.sessionId}:${zone.id}:${person.id}:${time}`,
            zone: { ...zone, rect: [...zone.rect] }, personId: person.id, personLabel: person.label, dwellMs,
            timestampBasis: input.source === 'demo' ? 'simulation' : 'decoded-video',
          });
        }
        occupants.push({ id: person.id, label: person.label, dwellMs: entry.fired ? Math.max(dwellMs, entry.flaggedMs) : dwellMs, flagged: entry.fired, state: boundary ? 'boundary' : 'inside' });
      }
      for (const id of entries.keys()) if (!seen.has(id)) entries.delete(id);
      previous = { status: uncertain ? 'uncertain' : 'watching', occupants };
      return { ...previous, triggers };
    },
  };
}
