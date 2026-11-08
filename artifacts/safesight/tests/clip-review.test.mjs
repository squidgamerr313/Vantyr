import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_LABELS, REVIEW_SCHEMA, REVIEW_STORAGE_KEY, parseBundle, newWorkspace,
  blankAnnotation, validateAnnotation, upsertAnnotation, parseWorkspace, parseReviewJSON,
  loadReviewStorage, saveReviewStorage, verifyReviewVideo, validateBox } from '../src/lib/clip-review.ts';

const bundle = () => ({
  schema: REVIEW_SCHEMA,
  videos: [{ id: 'v1', filename: 'fixture.mp4', sha256: 'a'.repeat(64), originalSha256: 'b'.repeat(64),
    durationMs: 10000, width: 720, height: 480, sourceGroup: 'fixture-recording', split: 'train' }],
  items: [{ id: 'item1', videoId: 'v1', eventId: 'e1', windowStartMs: 1000, windowEndMs: 2875,
    suggestedStartMs: 1000, suggestedEndMs: 3000, suggestedLabel: 'push', suggestedBox: [0, 0, .9, 1],
    flags: ['synthetic contract only'] }],
});
const reviewed = () => ({ ...blankAnnotation(bundle().items[0]), decision: 'reviewed',
  humanConfirmed: true, permissionConfirmed: true,
  anchors: [{ actor: 'A', timeMs: 2000, box: [.1, .1, .4, .9] },
            { actor: 'B', timeMs: 2000, box: [.5, .1, .8, .9] }] });
function storage(raw = null) {
  let value = raw;
  return { getItem(key) { assert.equal(key, REVIEW_STORAGE_KEY); return value; },
    setItem(key, v) { assert.equal(key, REVIEW_STORAGE_KEY); value = v; }, raw: () => value };
}

test('publisher suggestions stay unreviewed; bundle import never creates reviews', () => {
  const result = parseReviewJSON(JSON.stringify(bundle()));
  assert.equal(result.annotations.length, 0);
  assert.equal(result.trainingReady, false);
  assert.equal(result.liveIntegrationEligible, false);
  assert.equal(blankAnnotation(result.bundle.items[0]).humanConfirmed, false);
  assert.equal(result.bundle.videos[0].originalSha256, 'b'.repeat(64));
  assert.deepEqual(ACTION_LABELS, ['punch', 'push', 'other', 'unknown']);
});
test('reviewed requires permission, human review and same-time two-person evidence', () => {
  const b = parseBundle(bundle()), good = reviewed();
  assert.equal(validateAnnotation(good, b).decision, 'reviewed');
  for (const bad of [{ ...good, humanConfirmed: false }, { ...good, permissionConfirmed: false },
    { ...good, label: 'unknown' }, { ...good, anchors: good.anchors.slice(0, 1) },
    { ...good, anchors: good.anchors.map((a, i) => ({ ...a, timeMs: a.timeMs+i })) }]) {
    assert.throws(() => validateAnnotation(bad, b));
  }
});
test('uncertain and excluded never require invented actor boxes', () => {
  for (const decision of ['draft', 'uncertain', 'excluded']) {
    assert.equal(validateAnnotation({ ...blankAnnotation(bundle().items[0]), decision, label: 'unknown' },
      bundle()).decision, decision);
  }
});
test('invalid geometry, times, source and duplicate annotations fail closed', () => {
  for (const box of [[0, 0, 0, 1], [-.1, 0, 1, 1], [0, 0, NaN, 1], [0, 0, 1, 1, 1]]) {
    assert.throws(() => validateBox(box));
  }
  assert.throws(() => parseBundle({ ...bundle(), videos: [...bundle().videos, ...bundle().videos] }));
  assert.throws(() => parseBundle({ ...bundle(), items: [{ ...bundle().items[0], videoId: 'missing' }] }));
  const ws = upsertAnnotation(newWorkspace(bundle()), reviewed());
  assert.throws(() => parseWorkspace({ ...ws, annotations: [...ws.annotations, ...ws.annotations] }));
  assert.throws(() => parseWorkspace({ ...ws, trainingReady: true }));
  assert.throws(() => validateAnnotation({ ...reviewed(), endMs: 10001 }, bundle()));
  assert.throws(() => validateAnnotation({ ...reviewed(), startMs: 2100 }, bundle()));
});
test('save, edit, serialize and restore preserve corrections without video bytes', () => {
  const s = storage(), ws = upsertAnnotation(newWorkspace(bundle()), reviewed());
  saveReviewStorage(s, ws);
  const loaded = loadReviewStorage(s);
  assert.equal(loaded.kind, 'ready');
  assert.deepEqual(loaded.workspace, ws);
  const edited = upsertAnnotation(loaded.workspace, { ...reviewed(), label: 'punch', notes: 'Correction' });
  assert.equal(edited.annotations.length, 1);
  assert.equal(parseReviewJSON(JSON.stringify(edited)).annotations[0].notes, 'Correction');
  assert.equal(JSON.stringify(edited).includes('data:video'), false);
});
test('damaged originals are retained and cannot be silently overwritten', () => {
  const raw = '{ damaged local review', s = storage(raw);
  assert.equal(loadReviewStorage(s).kind, 'damaged');
  assert.equal(loadReviewStorage(s).raw, raw);
  assert.throws(() => saveReviewStorage(s, newWorkspace(bundle())), /damaged/);
  assert.equal(s.raw(), raw);
  const denied = { getItem() { throw new Error('denied'); } };
  assert.equal(loadReviewStorage(denied).kind, 'unavailable');
});
test('video binding uses content hash, not filename; oversized/incorrect input rejected', async () => {
  const file = new File(['synthetic media bytes, not a real action'], 'fixture.mp4');
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = Buffer.from(hash).toString('hex');
  await verifyReviewVideo(file, { ...bundle().videos[0], sha256 });
  await assert.rejects(verifyReviewVideo(file, bundle().videos[0]), /SHA256/);
  await assert.rejects(verifyReviewVideo({ size: 129*1024*1024 }, bundle().videos[0]), /128 MB/);
});
