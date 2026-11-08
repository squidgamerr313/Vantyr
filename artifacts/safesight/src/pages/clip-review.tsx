import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { AlertTriangle, Download, FileJson, Film, Pause, Play, RotateCcw, SkipBack, SkipForward, Trash2, Crosshair } from 'lucide-react';
import { AppShell, PageHeader, Panel } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { BoxOverlay, ACTOR_TONE } from '@/components/clip-review/box-overlay';
import { cn } from '@/lib/utils';
import {
  ACTION_LABELS, blankAnnotation, loadReviewStorage, parseReviewJSON, saveReviewStorage, upsertAnnotation, verifyReviewVideo,
  validateBox, type ActionLabel, type ActorAnchor, type Box, type ClipAnnotation, type ReviewItem, type ReviewWorkspace, type StorageRead,
} from '@/lib/clip-review';

const STEP_MS = 125;
const IMPORT_LIMIT = 5_000_000;
// Survives SPA back/navigation, never reload, and never contains media bytes/URLs.
let sessionDraft: { ws: ReviewWorkspace | null; selectedId: string | null; draft: ClipAnnotation | null; dirty: boolean; exportNeeded: boolean } | null = null;
type Decision = ClipAnnotation['decision'];
type VideoState =
  | { status: 'none' }
  | { status: 'hashing'; videoId: string; name: string }
  | { status: 'decoding'; videoId: string; url: string; name: string }
  | { status: 'ready'; videoId: string; url: string; name: string }
  | { status: 'error'; videoId: string; error: string };

const fmt = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;
};
const DECISION_TONE: Record<Decision | 'open', string> = {
  open: 'bg-[hsl(var(--muted))] text-muted-foreground',
  draft: 'bg-[hsl(40_90%_93%)] text-[hsl(var(--warn))]',
  reviewed: 'bg-[hsl(158_60%_94%)] text-[hsl(var(--safe))]',
  uncertain: 'bg-[hsl(var(--muted))] text-[hsl(var(--ink)/0.8)]',
  excluded: 'bg-[hsl(352_80%_95%)] text-[hsl(var(--hot))]',
};
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const getStorage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

function Tag({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <span data-testid={testId} className={cn('inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider', className)}>{children}</span>;
}

export default function ClipReview() {
  const [storage, setStorage] = useState<StorageRead>(() => { const s = getStorage(); return s ? loadReviewStorage(s) : { kind: 'unavailable', error: 'Browser storage is unavailable. Export your work before leaving.' }; });
  const [ws, setWs] = useState<ReviewWorkspace | null>(sessionDraft?.ws ?? (storage.kind === 'ready' ? storage.workspace : null));
  const [storageWarn, setStorageWarn] = useState<string | null>(storage.kind === 'unavailable' ? storage.error : null);
  const [selectedId, setSelectedId] = useState<string | null>(sessionDraft?.selectedId ?? null);
  const [draft, setDraft] = useState<ClipAnnotation | null>(sessionDraft?.draft ?? null);
  const [dirty, setDirty] = useState(sessionDraft?.dirty ?? false);
  const [exportNeeded, setExportNeeded] = useState(sessionDraft?.exportNeeded ?? false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => void } | null>(null);
  const [video, setVideo] = useState<VideoState>({ status: 'none' });
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [actor, setActor] = useState<'A' | 'B'>('A');
  const videoEl = useRef<HTMLVideoElement>(null);
  const attachToken = useRef(0);
  const urlRef = useRef<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  useEffect(() => { sessionDraft = { ws, selectedId, draft, dirty, exportNeeded }; }, [ws, selectedId, draft, dirty, exportNeeded]);
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute('content') ?? '';
    document.title = 'Clip review | VANTYR';
    meta?.setAttribute('content', 'Local human clip review: inspect source footage and annotate intervals and participants. Nothing leaves this browser.');
    return () => { document.title = prevTitle; meta?.setAttribute('content', prevDesc); };
  }, []);

  // Blob URL lifecycle: revoke on replacement and unmount.
  const setVideoUrl = useCallback((url: string | null) => {
    if (urlRef.current && urlRef.current !== url) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
  }, []);
  useEffect(() => () => { attachToken.current++; if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  useEffect(() => {
    if (!dirty && !exportNeeded) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const click = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute('download') || anchor.target === '_blank') return;
      const next = new URL(anchor.href, location.href);
      if (next.origin !== location.origin || next.pathname === location.pathname) return;
      if (!window.confirm('This review has unsaved edits or metadata not stored locally. Save or export before leaving. Leave anyway?')) {
        e.preventDefault(); e.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', h);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', h); document.removeEventListener('click', click, true); };
  }, [dirty, exportNeeded]);

  const item = useMemo(() => ws?.bundle.items.find((i) => i.id === selectedId) ?? null, [ws, selectedId]);
  const source = useMemo(() => (item && ws ? ws.bundle.videos.find((v) => v.id === item.videoId) ?? null : null), [ws, item]);
  const saved = useMemo(() => new Map((ws?.annotations ?? []).map((a) => [a.itemId, a])), [ws]);
  const progress = useMemo(() => {
    const c = { reviewed: 0, uncertain: 0, excluded: 0, draft: 0 };
    ws?.annotations.forEach((a) => { c[a.decision]++; });
    return c;
  }, [ws]);
  const videoReady = video.status === 'ready' && source?.id === video.videoId;

  const persist = (next: ReviewWorkspace) => {
    setWs(next);
    const s = getStorage();
    if (!s) { setExportNeeded(true); setStorageWarn('Browser storage is unavailable. Export JSON before leaving.'); return; }
    try { saveReviewStorage(s, next); setStorageWarn(null); setExportNeeded(false); }
    catch (e) { setExportNeeded(true); setStorageWarn(`${e instanceof Error ? e.message : 'Storage write failed.'} Use Export JSON to keep this work.`); }
  };

  const guard = (title: string, body: string, run: () => void, needed: boolean) => {
    if (needed) setConfirm({ title, body, run }); else run();
  };

  const dropVideo = () => {
    attachToken.current++;
    setVideoUrl(null);
    setVideo({ status: 'none' });
    setPlaying(false);
  };

  const openItem = (next: ReviewItem) => {
    if (next.id === selectedId) return;
    guard('Discard unsaved changes?', 'This clip has edits that are not saved. Opening another clip drops them.', () => {
      setSelectedId(next.id);
      setDraft(saved.get(next.id) ?? blankAnnotation(next));
      setDirty(false); setMessage(null);
      if (source?.id !== next.videoId) dropVideo();
      else if (videoEl.current) {
        videoEl.current.pause();
        videoEl.current.currentTime = next.suggestedStartMs / 1000;
      }
      setTimeMs(next.suggestedStartMs);
    }, dirty && next.id !== selectedId);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setImportError(null);
    if (file.size > IMPORT_LIMIT) { setImportError('Review metadata must be smaller than 5 MB. Current work is unchanged.'); return; }
    let next: ReviewWorkspace;
    try { next = parseReviewJSON(await file.text()); }
    catch (err) { setImportError(`${err instanceof Error ? err.message : 'Could not read file.'} Current work is unchanged.`); return; }
    const apply = () => {
      dropVideo(); setSelectedId(null); setDraft(null); setDirty(false); setMessage(null);
      persist(next);
    };
    guard('Replace the current review workspace?', `Importing ${file.name} replaces the open queue and its saved annotations${dirty ? ', and drops unsaved edits' : ''}. Export first if you need to keep them.`, apply, !!ws);
  };

  const onAttach = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !source) return;
    const token = ++attachToken.current;
    const target = source;
    setVideoUrl(null);
    setVideo({ status: 'hashing', videoId: target.id, name: file.name });
    try {
      await verifyReviewVideo(file, target);
    } catch (err) {
      if (token !== attachToken.current) return;
      setVideo({ status: 'error', videoId: target.id, error: err instanceof Error ? err.message : 'Verification failed.' });
      return;
    }
    if (token !== attachToken.current) return; // stale: source changed while hashing
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideo({ status: 'decoding', videoId: target.id, url, name: file.name });
  };

  const onMeta = () => {
    const el = videoEl.current;
    if (!el || video.status !== 'decoding' || !source) return;
    const dMs = el.duration * 1000;
    const geomOk = Math.abs(el.videoWidth - source.width) <= 2 && Math.abs(el.videoHeight - source.height) <= 2;
    const durOk = Number.isFinite(dMs) && Math.abs(dMs - source.durationMs) <= Math.max(250, source.durationMs * 0.02);
    if (!geomOk || !durOk) {
      setVideoUrl(null);
      setVideo({ status: 'error', videoId: source.id, error: !geomOk
        ? `Decoded geometry ${el.videoWidth}x${el.videoHeight} does not match manifest ${source.width}x${source.height}. Detached.`
        : `Decoded duration ${fmt(dMs)} does not match manifest ${fmt(source.durationMs)}. Detached.` });
      return;
    }
    setVideo({ status: 'ready', videoId: source.id, url: video.url, name: video.name });
    if (item) el.currentTime = item.suggestedStartMs / 1000;
  };
  const onVideoError = () => {
    if (video.status !== 'decoding' && video.status !== 'ready') return;
    const code = videoEl.current?.error?.code;
    setVideoUrl(null);
    setVideo({ status: 'error', videoId: video.videoId, error: `The browser could not decode this file${code ? ` (media error ${code})` : ''}. Hash matched, but the codec or container is unsupported here.` });
  };

  const seek = (ms: number) => {
    const el = videoEl.current; if (!el || !source) return;
    el.pause();
    const t = Math.min(source.durationMs, Math.max(0, ms));
    el.currentTime = t / 1000; setTimeMs(t);
  };
  const togglePlay = () => {
    const el = videoEl.current; if (!el) return;
    if (el.paused) void el.play().catch(() => setMessage({ tone: 'error', text: 'Playback could not start. Try attaching a browser-compatible MP4.' }));
    else el.pause();
  };

  const edit = (patch: Partial<ClipAnnotation>) => { if (!draft) return; setDraft({ ...draft, ...patch }); setDirty(true); setMessage(null); };
  const nowMs = Math.round(timeMs);
  const anchorsNow = draft?.anchors.filter((a) => a.timeMs === nowMs) ?? [];
  const outside = draft ? draft.anchors.filter((a) => a.timeMs < draft.startMs || a.timeMs > draft.endMs) : [];
  const inInterval = !!draft && nowMs >= draft.startMs && nowMs <= draft.endMs;

  const setAnchor = (who: 'A' | 'B', t: number, box: Box) => {
    if (!draft) return;
    edit({ anchors: [...draft.anchors.filter((a) => !(a.actor === who && a.timeMs === t)), { actor: who, timeMs: t, box }].sort((a, b) => a.timeMs - b.timeMs || a.actor.localeCompare(b.actor)) });
  };
  const removeAnchor = (a: ActorAnchor) => draft && edit({ anchors: draft.anchors.filter((x) => x !== a) });

  const save = (decision: Decision) => {
    if (!ws || !draft || !item) return;
    if (decision === 'reviewed' && !videoReady) { setMessage({ tone: 'error', text: 'Attach and decode the matching source video before marking reviewed.' }); return; }
    const value: ClipAnnotation = { ...draft, decision, updatedAt: new Date().toISOString() };
    try {
      const next = upsertAnnotation(ws, value);
      persist(next); setDraft(value); setDirty(false);
      setMessage({ tone: 'ok', text: `Saved as ${decision} at ${new Date(value.updatedAt).toLocaleTimeString()}.` });
    } catch (e) { setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not save.' }); }
  };

  const exportWs = () => {
    if (!ws) return;
    try {
      const next = dirty && draft ? upsertAnnotation(ws, { ...draft, decision: 'draft', updatedAt: new Date().toISOString() }) : ws;
      download(`vantyr-clip-review-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(next, null, 2));
      // Export includes valid pending edits as a draft, never as a new review.
      if (dirty && draft) { persist(next); setDraft(next.annotations.find(a => a.itemId === draft.itemId)!); setDirty(false); }
      setExportNeeded(false);
      setMessage({ tone: 'ok', text: 'JSON download started. Pending edits were included as a draft; keep this file to restore them.' });
    } catch (e) { setMessage({ tone: 'error', text: `Export blocked: ${e instanceof Error ? e.message : 'Invalid draft.'} Correct the draft or save it before exporting.` }); }
  };

  const header = (
    <PageHeader eyebrow="Research workbench · local only" title="Clip review"
      sub="Inspect source footage and record what a person actually saw. Suggestions are hints from the bundle publisher, never conclusions."
      right={<>
        <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={onImport} data-testid="input-import-review" />
        <Button variant="outline" onClick={() => importInput.current?.click()} disabled={storage.kind === 'damaged'} data-testid="button-import-review"><FileJson className="mr-2 h-4 w-4" />Import JSON</Button>
        <Button onClick={exportWs} disabled={!ws} data-testid="button-export-review"><Download className="mr-2 h-4 w-4" />Export JSON</Button>
      </>} />
  );

  const dialog = (
    <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
      <AlertDialogContent data-testid="dialog-confirm-review">
        <AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.body}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-confirm-cancel">Keep current work</AlertDialogCancel>
          <AlertDialogAction data-testid="button-confirm-proceed" onClick={() => { confirm?.run(); setConfirm(null); }}>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (storage.kind === 'damaged') {
    return (
      <AppShell>{header}{dialog}
        <div data-testid="status-storage-damaged" className="max-w-2xl rounded-xl border border-[hsl(352_60%_82%)] bg-[hsl(352_80%_97%)] p-6">
          <p className="flex items-center gap-2 font-display text-xl font-semibold text-[hsl(var(--hot))]"><AlertTriangle className="h-5 w-5" />Saved review metadata is damaged</p>
          <p className="mt-2 text-sm text-muted-foreground">{storage.error} The original is kept untouched. Export it before resetting; nothing is overwritten until you choose to.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => download('vantyr-clip-review-damaged-raw.json', storage.raw)} data-testid="button-export-raw"><Download className="mr-2 h-4 w-4" />Export original</Button>
            <Button variant="destructive" data-testid="button-reset-storage" onClick={() => setConfirm({ title: 'Reset saved review metadata?', body: 'This deletes the damaged entry from browser storage. Export it first if you may need it.', run: () => {
              try {
                const local = getStorage();
                if (!local) throw new Error('Storage unavailable');
                local.removeItem('vantyr.clip-review.v1'); sessionDraft = null;
                setStorage({ kind: 'empty' }); setWs(null); setDraft(null); setSelectedId(null); setDirty(false); setExportNeeded(false);
              }
              catch { setStorageWarn('Could not reset browser storage.'); }
            } })}><RotateCcw className="mr-2 h-4 w-4" />Reset storage</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {header}{dialog}
      {storageWarn && <p data-testid="status-storage-warning" className="mb-4 flex items-center gap-2 rounded-lg bg-[hsl(40_90%_93%)] px-3 py-2 text-sm text-[hsl(var(--warn))]"><AlertTriangle className="h-4 w-4 shrink-0" />{storageWarn}</p>}
      {importError && <p data-testid="status-import-error" role="alert" className="mb-4 rounded-lg bg-[hsl(352_80%_95%)] px-3 py-2 text-sm text-[hsl(var(--hot))]">{importError}</p>}

      {!ws ? (
        <div data-testid="empty-review" className="grid max-w-3xl gap-6 md:grid-cols-[auto_1fr]">
          <div className="font-mono text-6xl font-semibold leading-none text-[hsl(var(--lens)/0.25)]">00</div>
          <div>
            <h2 className="font-display text-2xl font-semibold">No review queue open</h2>
            <ol className="mt-4 space-y-3 text-[15px] text-muted-foreground">
              <li><span className="font-mono text-lens">1</span> Import the supplied <code className="font-mono text-foreground">review-bundle.json</code>, or a workspace JSON you exported earlier.</li>
              <li><span className="font-mono text-lens">2</span> Pick a clip, then select the corresponding locally prepared MP4. It is checked against the manifest SHA256 and never leaves this browser.</li>
              <li><span className="font-mono text-lens">3</span> Mark the interval and the two participants yourself. Save as reviewed, uncertain, or excluded.</li>
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">Only metadata is kept in browser storage. Footage stays in memory and is released when you leave.</p>
            <Button className="mt-5" onClick={() => importInput.current?.click()} data-testid="button-import-empty"><FileJson className="mr-2 h-4 w-4" />Import review JSON</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
          <Panel title={`Queue · ${ws.bundle.items.length}`}>
            <div data-testid="status-progress" className="mb-3">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                {(['reviewed', 'uncertain', 'excluded', 'draft'] as const).map((k) => (
                  <div key={k} className={cn('h-full', { reviewed: 'bg-[hsl(var(--safe))]', uncertain: 'bg-[hsl(var(--ink)/0.4)]', excluded: 'bg-[hsl(var(--hot))]', draft: 'bg-[hsl(var(--warn))]' }[k])} style={{ width: `${(progress[k] / ws.bundle.items.length) * 100}%` }} />
                ))}
              </div>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">{progress.reviewed} reviewed · {progress.uncertain} uncertain · {progress.excluded} excluded · {progress.draft} draft</p>
            </div>
            <ul className="max-h-[70dvh] space-y-1 overflow-y-auto pr-1">
              {ws.bundle.items.map((it) => {
                const v = ws.bundle.videos.find((x) => x.id === it.videoId)!;
                const a = saved.get(it.id);
                return (
                  <li key={it.id}>
                    <button data-testid={`button-queue-item-${it.id}`} onClick={() => openItem(it)} aria-current={it.id === selectedId}
                      className={cn('w-full rounded-lg px-3 py-2 text-left transition-colors', it.id === selectedId ? 'bg-[hsl(var(--lens)/0.08)] ring-1 ring-[hsl(var(--lens)/0.3)]' : 'hover:bg-[hsl(var(--muted))]')}>
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs">{it.eventId}</span>
                        <Tag className={cn('ml-auto', DECISION_TONE[a?.decision ?? 'open'])} testId={`status-item-${it.id}`}>{a?.decision ?? 'open'}</Tag>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="truncate">{v.filename}</span>
                        <Tag className="bg-[hsl(var(--muted))]">{v.split}</Tag>
                        {it.flags.length > 0 && <Tag className="bg-[hsl(40_90%_93%)] text-[hsl(var(--warn))]">{it.flags.length} flag{it.flags.length > 1 ? 's' : ''}</Tag>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {!item || !draft || !source ? (
            <div data-testid="empty-selection" className="grid min-h-[320px] place-items-center rounded-xl border border-dashed border-[hsl(var(--rule))] text-sm text-muted-foreground">Select a clip from the queue to begin.</div>
          ) : (
            <div className="grid min-w-0 gap-8 xl:grid-cols-[1fr_340px]">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span data-testid="text-item-event" className="font-mono">{item.eventId}</span>
                  <span className="text-muted-foreground">·</span>
                  <span data-testid="text-source-file" className="truncate">{source.filename}</span>
                  <Tag className="bg-[hsl(var(--muted))]" testId="text-source-split">{source.split}</Tag>
                  <Tag className="bg-[hsl(var(--muted))]" testId="text-source-group">{source.sourceGroup}</Tag>
                  <span className="font-mono text-[11px] text-muted-foreground">{source.width}x{source.height} · {fmt(source.durationMs)}</span>
                  {dirty && <Tag className="bg-[hsl(40_90%_93%)] text-[hsl(var(--warn))]" testId="status-unsaved">unsaved</Tag>}
                </div>
                {item.flags.length > 0 && (
                  <ul data-testid="list-diagnostic-flags" className="flex flex-wrap gap-1.5">
                    {item.flags.map((f, i) => <li key={i} data-testid={`text-flag-${i}`} className="rounded-md bg-[hsl(40_90%_93%)] px-2 py-0.5 font-mono text-[11px] text-[hsl(var(--warn))]">{f}</li>)}
                  </ul>
                )}

                <BoxOverlay width={source.width} height={source.height} visible={anchorsNow}
                  suggested={inInterval || !videoReady ? item.suggestedBox : null} drawActor={actor} enabled={videoReady && !playing}
                  onDraw={(box) => { if (!inInterval) { setMessage({ tone: 'error', text: 'Move the playhead inside the action interval before drawing.' }); return; } setAnchor(actor, nowMs, box); }}>
                  {(video.status === 'decoding' || video.status === 'ready') && video.videoId === source.id ? (
                    <video key={video.url} ref={videoEl} src={video.url} data-testid="video-review" className="absolute inset-0 h-full w-full object-fill" playsInline preload="auto" muted
                      onLoadedMetadata={onMeta} onError={onVideoError} onTimeUpdate={(e) => setTimeMs(e.currentTarget.currentTime * 1000)}
                      onSeeked={(e) => setTimeMs(e.currentTarget.currentTime * 1000)} onPlay={() => setPlaying(true)} onPause={(e) => { setPlaying(false); setTimeMs(e.currentTarget.currentTime * 1000); }} />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
                      <div>
                        <Film className="mx-auto mb-3 h-7 w-7 text-white/50" />
                        {video.status === 'hashing' ? <p data-testid="status-video-hashing">Checking SHA256 of {video.name}...</p>
                          : <p>Select the local file <span className="font-mono">{source.filename}</span>. It is verified against the manifest hash.</p>}
                        {video.status === 'error' && video.videoId === source.id && <p data-testid="status-video-error" role="alert" className="mt-3 text-[hsl(352_90%_78%)]">{video.error}</p>}
                      </div>
                    </div>
                  )}
                </BoxOverlay>

                <div className="flex flex-wrap items-center gap-2">
                  <input ref={videoInput} type="file" accept="video/mp4,video/*" className="hidden" onChange={onAttach} data-testid="input-attach-video" />
                  <Button variant="outline" size="sm" onClick={() => videoInput.current?.click()} disabled={video.status === 'hashing'} data-testid="button-attach-video"><Film className="mr-2 h-4 w-4" />{videoReady ? 'Replace video' : 'Attach local video'}</Button>
                  <span data-testid="status-video" className="font-mono text-[11px] text-muted-foreground">{videoReady ? 'source verified + decoded' : video.status === 'decoding' ? 'decoding...' : 'no verified source'}</span>
                </div>

                <div className={cn('space-y-3 rounded-xl border border-[hsl(var(--rule))] p-3', !videoReady && 'pointer-events-none opacity-50')} aria-disabled={!videoReady}>
                  <div className="relative h-6">
                    <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[hsl(var(--muted))]" />
                    <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm bg-[hsl(var(--ink)/0.15)]" style={{ left: `${(item.windowStartMs / source.durationMs) * 100}%`, width: `${((item.windowEndMs - item.windowStartMs) / source.durationMs) * 100}%` }} />
                    <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm bg-[hsl(var(--lens)/0.55)]" style={{ left: `${(draft.startMs / source.durationMs) * 100}%`, width: `${(Math.max(0, draft.endMs - draft.startMs) / source.durationMs) * 100}%` }} />
                    <input type="range" min={0} max={source.durationMs} step={1} value={Math.min(timeMs, source.durationMs)} onChange={(e) => seek(Number(e.target.value))}
                      aria-label="Scrub video" data-testid="input-scrub" className="absolute inset-0 w-full cursor-pointer opacity-0" />
                    <div className="pointer-events-none absolute top-0 h-6 w-[2px] bg-[hsl(var(--ink))]" style={{ left: `${(Math.min(timeMs, source.durationMs) / source.durationMs) * 100}%` }} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => seek(timeMs - STEP_MS)} data-testid="button-step-back" aria-label="Back one 125 ms sample step"><SkipBack className="h-4 w-4" /></Button>
                    <Button size="sm" onClick={togglePlay} data-testid="button-play-pause" aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
                    <Button size="sm" variant="outline" onClick={() => seek(timeMs + STEP_MS)} data-testid="button-step-forward" aria-label="Forward one 125 ms sample step"><SkipForward className="h-4 w-4" /></Button>
                    <span data-testid="text-current-time" className="ml-1 font-mono text-sm tabular-nums">{fmt(timeMs)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">125 ms sample step, not native-frame exact</span>
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => seek(item.windowStartMs)} data-testid="button-jump-window">Crop start</Button>
                      <Button size="sm" variant="ghost" onClick={() => seek(item.suggestedStartMs)} data-testid="button-jump-suggested">Suggested start</Button>
                      <Button size="sm" variant="ghost" onClick={() => seek(draft.startMs)} data-testid="button-jump-action">Action start</Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <Panel title="Interval & label">
                  <p className="mb-2 text-xs text-muted-foreground">Publisher suggested <span className="font-mono">{item.suggestedLabel}</span> at {fmt(item.suggestedStartMs)} to {fmt(item.suggestedEndMs)}. Unconfirmed.</p>
                  <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Action label">
                    {ACTION_LABELS.map((l) => (
                      <button key={l} role="radio" aria-checked={draft.label === l} data-testid={`button-label-${l}`} onClick={() => edit({ label: l as ActionLabel })}
                        className={cn('rounded-md px-2 py-1.5 font-mono text-xs uppercase ring-1', draft.label === l ? 'bg-[hsl(var(--ink))] text-[hsl(var(--background))] ring-transparent' : 'ring-[hsl(var(--rule))] hover:bg-[hsl(var(--muted))]')}>{l}</button>
                    ))}
                  </div>
                  {(['startMs', 'endMs'] as const).map((k) => (
                    <div key={k} className="mt-3 flex items-center gap-2">
                      <label className="w-12 text-xs text-muted-foreground" htmlFor={`in-${k}`}>{k === 'startMs' ? 'Start' : 'End'}</label>
                      <input id={`in-${k}`} type="number" min={0} max={source.durationMs} value={draft[k]} onChange={(e) => edit({ [k]: Number(e.target.value) })}
                        data-testid={`input-${k === 'startMs' ? 'start' : 'end'}-ms`} className="w-28 rounded-md border border-[hsl(var(--rule))] bg-transparent px-2 py-1 font-mono text-sm" />
                      <span className="font-mono text-[11px] text-muted-foreground">ms</span>
                      <Button size="sm" variant="outline" className="ml-auto" disabled={!videoReady} onClick={() => edit({ [k]: nowMs })} data-testid={`button-mark-${k === 'startMs' ? 'start' : 'end'}`}>Mark current</Button>
                    </div>
                  ))}
                  {draft.startMs >= draft.endMs && <p data-testid="status-interval-invalid" className="mt-2 text-xs text-[hsl(var(--hot))]">Start must be before end.</p>}
                  {outside.length > 0 && (
                    <div data-testid="status-anchors-outside" className="mt-2 rounded-md bg-[hsl(40_90%_93%)] p-2 text-xs text-[hsl(var(--warn))]">
                      {outside.length} keyframe{outside.length > 1 ? 's are' : ' is'} outside the interval. They are kept until you decide.
                      <Button size="sm" variant="ghost" className="ml-1 h-6 px-2" onClick={() => edit({ anchors: draft.anchors.filter((a) => !outside.includes(a)) })} data-testid="button-remove-outside">Remove them</Button>
                    </div>
                  )}
                </Panel>

                <Panel title="Participants" icon={<Crosshair className="h-4 w-4" />} right={draft.anchors.length > 0 && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => edit({ anchors: [] })} data-testid="button-clear-anchors">Clear all</Button>}>
                  <p className="mb-2 text-xs text-muted-foreground">Pause, then drag on the frame to box a person at {fmt(nowMs)}. Boxes are per keyframe; identity is not carried between frames.</p>
                  <div className="mb-3 flex gap-1">
                    {(['A', 'B'] as const).map((p) => (
                      <button key={p} data-testid={`button-actor-${p}`} aria-pressed={actor === p} onClick={() => setActor(p)}
                        className={cn('flex-1 rounded-md px-2 py-1.5 text-sm ring-1', actor === p ? 'text-white ring-transparent' : 'ring-[hsl(var(--rule))]')} style={actor === p ? { background: ACTOR_TONE[p] } : undefined}>
                        Person {p}{anchorsNow.some((a) => a.actor === p) ? ' · here' : ''}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="mb-3 w-full" disabled={!videoReady || !inInterval} onClick={() => setAnchor(actor, nowMs, anchorsNow.find((a) => a.actor === actor)?.box ?? [0.4, 0.3, 0.6, 0.9])} data-testid="button-add-numeric-box">Add numeric box for {actor} at current time</Button>
                  <ul className="space-y-2" data-testid="list-anchors">
                    {draft.anchors.length === 0 && <li className="text-xs text-muted-foreground">No keyframes yet.</li>}
                    {draft.anchors.map((a) => {
                      const id = `${a.actor}-${a.timeMs}`;
                      return (
                        <li key={id} data-testid={`row-anchor-${id}`} className={cn('rounded-md p-2 ring-1 ring-[hsl(var(--rule))]', a.timeMs === nowMs && 'bg-[hsl(var(--muted))]')}>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-mono font-semibold" style={{ color: ACTOR_TONE[a.actor] }}>{a.actor}</span>
                            <button className="font-mono underline-offset-2 hover:underline" onClick={() => seek(a.timeMs)} data-testid={`button-seek-anchor-${id}`}>{fmt(a.timeMs)}</button>
                            <button className="ml-auto text-muted-foreground hover:text-[hsl(var(--hot))]" onClick={() => removeAnchor(a)} aria-label={`Remove ${a.actor} keyframe`} data-testid={`button-remove-anchor-${id}`}><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                          <div className="mt-1.5 grid grid-cols-4 gap-1">
                            {(['x1', 'y1', 'x2', 'y2'] as const).map((n, i) => (
                              <input key={`${n}-${a.box[i]}`} type="number" min={0} max={1} step={0.01} aria-label={`${a.actor} ${n}`} defaultValue={a.box[i]} data-testid={`input-anchor-${id}-${n}`}
                                onBlur={(e) => {
                                  const box = [...a.box] as Box; box[i] = Number(e.target.value);
                                  try { setAnchor(a.actor, a.timeMs, validateBox(box)); } catch (err) { e.target.value = String(a.box[i]); setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Invalid box.' }); }
                                }}
                                className="w-full rounded border border-[hsl(var(--rule))] bg-transparent px-1 py-0.5 font-mono text-[11px]" />
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>

                <Panel title="Decision">
                  <textarea value={draft.notes} maxLength={2000} onChange={(e) => edit({ notes: e.target.value })} placeholder="What you saw, what was ambiguous." data-testid="input-notes"
                    className="h-20 w-full rounded-md border border-[hsl(var(--rule))] bg-transparent p-2 text-sm" />
                  <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={draft.permissionConfirmed} onChange={(e) => edit({ permissionConfirmed: e.target.checked })} data-testid="checkbox-permission" className="mt-0.5" />I have permission to review and annotate this footage.</label>
                  <label className="mt-1.5 flex items-start gap-2 text-xs"><input type="checkbox" checked={draft.humanConfirmed} onChange={(e) => edit({ humanConfirmed: e.target.checked })} data-testid="checkbox-human-review" className="mt-0.5" />I personally watched this interval; the label and boxes are mine, not copied suggestions.</label>
                  <p className="mt-2 text-[11px] text-muted-foreground">Reviewed records an observed action label only. It does not verify contact, intent, or harm.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={() => save('draft')} data-testid="button-save-draft">Save draft</Button>
                    <Button onClick={() => save('reviewed')} disabled={!videoReady} data-testid="button-save-reviewed">Save reviewed</Button>
                    <Button variant="outline" onClick={() => save('uncertain')} data-testid="button-save-uncertain">Uncertain</Button>
                    <Button variant="outline" onClick={() => save('excluded')} data-testid="button-save-excluded">Exclude</Button>
                  </div>
                  {saved.get(item.id) && saved.get(item.id)!.decision !== 'draft' && (
                    <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => save('draft')} data-testid="button-reopen">Reopen as draft</Button>
                  )}
                  {message && <p data-testid={message.tone === 'ok' ? 'status-save-ok' : 'status-save-error'} role={message.tone === 'error' ? 'alert' : 'status'}
                    className={cn('mt-3 text-xs', message.tone === 'ok' ? 'text-[hsl(var(--safe))]' : 'text-[hsl(var(--hot))]')}>{message.text}</p>}
                </Panel>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
