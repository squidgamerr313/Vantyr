/** Human annotation only. No inference, media upload, or training side effects. */
export const REVIEW_SCHEMA = 'vantyr-human-clip-review-v1' as const;
export const REVIEW_STORAGE_KEY = 'vantyr.clip-review.v1';
export const ACTION_LABELS = ['punch', 'push', 'other', 'unknown'] as const;
export type ActionLabel = typeof ACTION_LABELS[number];
export type Box = [number, number, number, number];
export type ReviewVideo = {
  id: string; filename: string; sha256: string; durationMs: number;
  originalSha256?: string;
  width: number; height: number; sourceGroup: string; split: 'train' | 'validation' | 'test';
};
export type ReviewItem = {
  id: string; videoId: string; eventId: string;
  windowStartMs: number; windowEndMs: number;
  suggestedStartMs: number; suggestedEndMs: number;
  suggestedLabel: ActionLabel; suggestedBox: Box | null; flags: string[];
};
export type ReviewBundle = {
  schema: typeof REVIEW_SCHEMA; videos: ReviewVideo[]; items: ReviewItem[];
};
export type ActorAnchor = { actor: 'A' | 'B'; timeMs: number; box: Box };
export type ClipAnnotation = {
  itemId: string; decision: 'draft' | 'reviewed' | 'uncertain' | 'excluded';
  label: ActionLabel; startMs: number; endMs: number; anchors: ActorAnchor[];
  notes: string; permissionConfirmed: boolean; humanConfirmed: boolean; updatedAt: string;
};
export type ReviewWorkspace = {
  schema: typeof REVIEW_SCHEMA; bundle: ReviewBundle; annotations: ClipAnnotation[];
  trainingReady: false; liveIntegrationEligible: false;
};
export type StorageRead =
  | { kind: 'empty' }
  | { kind: 'ready'; workspace: ReviewWorkspace }
  | { kind: 'damaged'; raw: string; error: string }
  | { kind: 'unavailable'; error: string };

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
};
function text(value: unknown, name: string, limit = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Invalid ${name}.`);
  return value;
}
function number(value: unknown, name: string, max = 86_400_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`Invalid ${name}.`);
  return value;
}
function array(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${name}.`);
  return value;
}
function label(value: unknown): ActionLabel {
  if (!ACTION_LABELS.includes(value as ActionLabel)) throw new Error('Invalid action label.');
  return value as ActionLabel;
}
export function validateBox(value: unknown): Box {
  const box = array(value, 'actor box', 4).map(v => number(v, 'box coordinate', 1));
  if (box.length !== 4 || box[0] >= box[2] || box[1] >= box[3]) throw new Error('Draw a non-empty box inside the image.');
  return box as Box;
}
export function parseBundle(value: unknown): ReviewBundle {
  const data = object(value);
  if (data.schema !== REVIEW_SCHEMA) throw new Error('Unsupported clip-review schema.');
  const videos: ReviewVideo[] = array(data.videos, 'videos', 200).map(raw => {
    const v = object(raw);
    const sha256 = text(v.sha256, 'video SHA256', 64);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid video SHA256.');
    const originalSha256 = v.originalSha256 === undefined ? undefined : text(v.originalSha256, 'original SHA256', 64);
    if (originalSha256 && !/^[a-f0-9]{64}$/.test(originalSha256)) throw new Error('Invalid original video SHA256.');
    if (!['train', 'validation', 'test'].includes(String(v.split))) throw new Error('Invalid source split.');
    const durationMs = number(v.durationMs, 'video duration');
    const width = number(v.width, 'video width', 8192), height = number(v.height, 'video height', 8192);
    if (!durationMs || !width || !height) throw new Error('Video geometry and duration must be positive.');
    return { id: text(v.id, 'video ID'), filename: text(v.filename, 'video filename'),
      sha256, ...(originalSha256 ? { originalSha256 } : {}), durationMs, width, height, sourceGroup: text(v.sourceGroup, 'source group'),
      split: v.split as ReviewVideo['split'] };
  });
  if (!videos.length || new Set(videos.map(v => v.id)).size !== videos.length ||
      new Set(videos.map(v => v.sha256)).size !== videos.length) throw new Error('Missing or duplicate video source.');
  const items: ReviewItem[] = array(data.items, 'review items', 1000).map(raw => {
    const r = object(raw), videoId = text(r.videoId, 'video ID');
    const video = videos.find(v => v.id === videoId);
    if (!video) throw new Error('Review item has no matching video.');
    const windowStartMs = number(r.windowStartMs, 'window start'), windowEndMs = number(r.windowEndMs, 'window end');
    const suggestedStartMs = number(r.suggestedStartMs, 'suggested start');
    const suggestedEndMs = number(r.suggestedEndMs, 'suggested end');
    if (windowStartMs >= windowEndMs || windowEndMs > video.durationMs ||
        suggestedStartMs >= suggestedEndMs || suggestedEndMs > video.durationMs) throw new Error('Review interval is outside its source video.');
    return { id: text(r.id, 'item ID'), videoId, eventId: text(r.eventId, 'event ID'),
      windowStartMs, windowEndMs, suggestedStartMs, suggestedEndMs,
      suggestedLabel: label(r.suggestedLabel),
      suggestedBox: r.suggestedBox === null ? null : validateBox(r.suggestedBox),
      flags: array(r.flags, 'diagnostic flags', 20).map(v => text(v, 'flag', 300)) };
  });
  if (!items.length || new Set(items.map(i => i.id)).size !== items.length) throw new Error('Missing or duplicate review item.');
  return { schema: REVIEW_SCHEMA, videos, items };
}
export function blankAnnotation(item: ReviewItem): ClipAnnotation {
  return { itemId: item.id, decision: 'draft', label: item.suggestedLabel,
    startMs: item.suggestedStartMs, endMs: item.suggestedEndMs, anchors: [], notes: '',
    permissionConfirmed: false, humanConfirmed: false, updatedAt: new Date().toISOString() };
}
export function validateAnnotation(value: unknown, bundle: ReviewBundle): ClipAnnotation {
  const r = object(value), itemId = text(r.itemId, 'item ID');
  const item = bundle.items.find(i => i.id === itemId);
  if (!item) throw new Error('Annotation refers to an unknown review item.');
  const video = bundle.videos.find(v => v.id === item.videoId)!;
  const decision = r.decision as ClipAnnotation['decision'];
  if (!['draft', 'reviewed', 'uncertain', 'excluded'].includes(decision)) throw new Error('Invalid review decision.');
  const action = label(r.label), startMs = number(r.startMs, 'action start'), endMs = number(r.endMs, 'action end');
  if (startMs >= endMs || endMs > video.durationMs) throw new Error('Action interval must be inside the video, with start before end.');
  const anchors: ActorAnchor[] = array(r.anchors, 'actor keyframes', 100).map(raw => {
    const a = object(raw);
    if (a.actor !== 'A' && a.actor !== 'B') throw new Error('Invalid participant.');
    const timeMs = number(a.timeMs, 'keyframe time');
    if (timeMs < startMs || timeMs > endMs) throw new Error('Actor keyframes must be inside the action interval.');
    return { actor: a.actor, timeMs, box: validateBox(a.box) };
  });
  if (new Set(anchors.map(a => `${a.actor}-${a.timeMs}`)).size !== anchors.length) throw new Error('Duplicate actor keyframe.');
  if (typeof r.notes !== 'string' || r.notes.length > 2000) throw new Error('Notes must be at most 2,000 characters.');
  if (typeof r.permissionConfirmed !== 'boolean' || typeof r.humanConfirmed !== 'boolean') throw new Error('Missing review confirmations.');
  if (decision === 'reviewed') {
    if (!r.permissionConfirmed || !r.humanConfirmed) throw new Error('Confirm permission and personal review before marking reviewed.');
    if (action === 'unknown') throw new Error('Use uncertain for an unknown action.');
    if (!anchors.some(a => a.actor === 'A') || !anchors.some(a => a.actor === 'B')) throw new Error('Mark both interacting people before marking reviewed.');
    if (!anchors.some(a => a.actor === 'A' && anchors.some(b => b.actor === 'B' && b.timeMs === a.timeMs))) {
      throw new Error('Mark both people at the same keyframe to establish the reviewed pair.');
    }
  }
  const updatedAt = text(r.updatedAt, 'review timestamp', 40);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('Invalid review timestamp.');
  return { itemId, decision, label: action, startMs, endMs, anchors, notes: r.notes,
    permissionConfirmed: r.permissionConfirmed, humanConfirmed: r.humanConfirmed, updatedAt };
}
export function parseWorkspace(value: unknown): ReviewWorkspace {
  const r = object(value);
  if (r.schema !== REVIEW_SCHEMA || r.trainingReady !== false || r.liveIntegrationEligible !== false) throw new Error('This file is not a research-only review workspace.');
  const bundle = parseBundle(r.bundle);
  const annotations = array(r.annotations, 'annotations', 1000).map(a => validateAnnotation(a, bundle));
  if (new Set(annotations.map(a => a.itemId)).size !== annotations.length) throw new Error('Duplicate saved annotation.');
  return { schema: REVIEW_SCHEMA, bundle, annotations, trainingReady: false, liveIntegrationEligible: false };
}
export function newWorkspace(bundle: ReviewBundle): ReviewWorkspace {
  return { schema: REVIEW_SCHEMA, bundle: parseBundle(bundle), annotations: [], trainingReady: false, liveIntegrationEligible: false };
}
export function upsertAnnotation(workspace: ReviewWorkspace, value: ClipAnnotation): ReviewWorkspace {
  const annotation = validateAnnotation(value, workspace.bundle);
  return { ...workspace, annotations: [...workspace.annotations.filter(a => a.itemId !== annotation.itemId), annotation] };
}
export function parseReviewJSON(raw: string): ReviewWorkspace {
  if (raw.length > 5_000_000) throw new Error('Review metadata must be smaller than 5 MB.');
  const value = object(JSON.parse(raw));
  return 'bundle' in value ? parseWorkspace(value) : newWorkspace(parseBundle(value));
}
export function loadReviewStorage(storage: Pick<Storage, 'getItem'>): StorageRead {
  let raw: string | null;
  try { raw = storage.getItem(REVIEW_STORAGE_KEY); }
  catch { return { kind: 'unavailable', error: 'Browser storage is unavailable. Export your work before leaving.' }; }
  if (raw === null) return { kind: 'empty' };
  try { return { kind: 'ready', workspace: parseWorkspace(JSON.parse(raw)) }; }
  catch (error) { return { kind: 'damaged', raw, error: error instanceof Error ? error.message : 'Invalid saved data.' }; }
}
export function saveReviewStorage(storage: Pick<Storage, 'getItem' | 'setItem'>, workspace: ReviewWorkspace): void {
  const state = loadReviewStorage(storage);
  if (state.kind === 'damaged') throw new Error('Saved metadata is damaged. Export the original and explicitly reset before saving.');
  if (state.kind === 'unavailable') throw new Error(state.error);
  storage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(parseWorkspace(workspace)));
}
export async function verifyReviewVideo(file: File, video: ReviewVideo): Promise<void> {
  if (file.size > 128 * 1024 * 1024) throw new Error('Local review supports videos up to 128 MB.');
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hex = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
  if (hex !== video.sha256) throw new Error('This video does not match the source SHA256. Nothing was attached.');
}
