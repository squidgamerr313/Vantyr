import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowRight, ChevronDown, ChevronRight, MessageCircle, RotateCcw, Search, Send, Trash2, Undo2, X } from 'lucide-react';
import { GUIDE, SETTING_LABELS, SETUP_KEYS, formatSetting, type GuideArticle, type SetupSettings } from '@workspace/safesight-guide';
import { AppShell } from '@/components/shell';
import { useSetupChat } from '@/hooks/use-setup-chat';
import './docs.css';

const MAX = 2000;
const CATEGORIES = Array.from(new Set(GUIDE.map((a) => a.category)));
const TITLES = Object.fromEntries(GUIDE.map((a) => [a.id, a.title]));
const STARTERS = [
  'I am trying this alone on an older laptop. Which local preferences would keep it usable?',
  'Our small team wants to try one fixed camera in a shared room. How should we plan the trial?',
  'Boxes and skeleton feel cluttered on my phone. What can I change without affecting scoring?',
  'We get too many repeated history records. Which logging preferences help?',
];

function articleText(a: GuideArticle) {
  const keys = SETUP_KEYS.filter((k) => [a.summary, ...a.paragraphs].join(' ').includes(SETTING_LABELS[k])).join(' ');
  return [a.title, a.category, a.summary, ...a.paragraphs, ...(a.steps ?? []), ...(a.keywords ?? []), keys].join(' ').toLowerCase();
}

function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const out: ReactNode[] = [];
  const lower = text.toLowerCase();
  let i = 0, k = 0;
  while (i < text.length) {
    const j = lower.indexOf(q, i);
    if (j < 0) { out.push(text.slice(i)); break; }
    if (j > i) out.push(text.slice(i, j));
    out.push(<mark key={k++} className="dc-hit">{text.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  return <>{out}</>;
}

export default function Docs() {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistantLauncher = useRef<HTMLButtonElement>(null);
  const assistantPanel = useRef<HTMLDivElement>(null);
  const closeAssistant = () => {
    setAssistantOpen(false);
    assistantLauncher.current?.focus({ preventScroll: true });
  };
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openOne = (id: string) => setOpen((o) => (o.has(id) ? o : new Set(o).add(id)));
  const pendingReveal = useRef<string | null>(null);
  const q = query.trim().toLowerCase();

  const index = useMemo(() => GUIDE.map((a) => ({ a, text: articleText(a) })), []);
  const visible = index.filter(({ a, text }) => (!cat || a.category === cat) && (!q || q.split(/\s+/).every((w) => text.includes(w)))).map((x) => x.a);
  const hl = q.includes(' ') ? '' : q;

  const reveal = (id: string) => {
    if (!GUIDE.some((a) => a.id === id)) return;
    setAssistantOpen(false);
    if (!visible.some((a) => a.id === id)) { setQuery(''); setCat(null); }
    openOne(id);
    pendingReveal.current = id;
    setFlash(id);
    history.replaceState(null, '', `#${id}`);
  };

  useEffect(() => {
    if (!assistantOpen) return;
    assistantPanel.current?.querySelector<HTMLButtonElement>('[data-testid="button-close-assistant"]')?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setAssistantOpen(false);
      assistantLauncher.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [assistantOpen]);

  useEffect(() => {
    const id = pendingReveal.current;
    if (!id) return;
    pendingReveal.current = null;
    const el = document.getElementById(id);
    if (el) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      el.querySelector<HTMLElement>('h2 a')?.focus({ preventScroll: true });
    }
    const t = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(t);
  });

  useEffect(() => {
    const previousTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute('content') ?? '';
    document.title = 'Docs & setup | VANTYR';
    meta?.setAttribute('content', 'Learn VANTYR’s camera, zone, privacy and review workflows. Get AI setup guidance and confirm local preference changes before applying.');
    return () => { document.title = previousTitle; meta?.setAttribute('content', previousDescription); };
  }, []);

  useEffect(() => {
    let id = '';
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    if (id === 'assistant') setAssistantOpen(true);
    if (id && GUIDE.some((a) => a.id === id)) { openOne(id); pendingReveal.current = id; setFlash(id); }
  }, []);

  return (
    <AppShell variant="brand">
      <div className="dc">
        <section className="dc-hero" aria-labelledby="docs-title">
          <div className="dc-hero-text">
            <h1 id="docs-title" className="dc-title">Docs and <span className="dc-grad">setup</span></h1>
            <p className="dc-lede">How VANTYR works, what it cannot tell you, and how to set up a small trial on your own device.</p>
          </div>
          <div className="dc-hero-actions">
            <button type="button" onClick={() => setAssistantOpen(true)} className="dc-btn dc-btn-onDark" data-testid="link-to-assistant">Ask the setup assistant <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
            <Link href="/dashboard" className="dc-btn dc-btn-onDark" data-testid="link-docs-monitor">Open the monitor</Link>
          </div>
        </section>

        <div className="dc-toolbar">
          <div className="dc-search" role="search">
            <Search className="h-5 w-5" aria-hidden="true" />
            <label htmlFor="docs-search" className="sr-only">Search the docs</label>
            <input id="docs-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: zone, frame interval, privacy, logThreshold" data-testid="input-docs-search" />
          </div>
          <nav className="dc-aside" aria-label="Doc categories">
            <div className="dc-cats">
              <button type="button" className="dc-cat" aria-pressed={cat === null} onClick={() => setCat(null)} data-testid="button-cat-all">All <span className="dc-cat-n">{GUIDE.length}</span></button>
              {CATEGORIES.map((c) => (
                <button key={c} type="button" className="dc-cat" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)} data-testid={`button-cat-${c.toLowerCase().replace(/\s+/g, '-')}`}>
                  {c} <span className="dc-cat-n">{GUIDE.filter((a) => a.category === c).length}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>

        <div className="dc-layout">
          <div className="dc-articles">
            <p className="sr-only" role="status" aria-live="polite" data-testid="status-docs-results">{visible.length} of {GUIDE.length} articles shown</p>
            {visible.length === 0 && (
              <div className="dc-empty" data-testid="state-docs-empty">
                <h2>Nothing matches “{query.trim() || cat}”</h2>
                <p className="mt-2 text-[15px] text-muted-foreground">Try a shorter word like camera, zone, privacy or logging{cat ? `, or search across all categories` : ''}. You can also ask the setup assistant.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" className="dc-btn dc-btn-blue" onClick={() => { setQuery(''); setCat(null); }} data-testid="button-docs-reset">Show all articles</button>
                  <button type="button" onClick={() => setAssistantOpen(true)} className="dc-btn">Ask the assistant</button>
                </div>
              </div>
            )}
            {visible.length > 0 && <p className="dc-hint">{q ? 'Matching articles are expanded.' : 'Select a topic to read it.'}</p>}
            <div className="dc-list">
              {visible.map((a) => {
                const isOpen = !!q || open.has(a.id);
                return (
                  <article key={a.id} id={a.id} className="dc-art" data-open={isOpen} data-flash={flash === a.id} aria-labelledby={`${a.id}-t`} data-testid={`article-${a.id}`}>
                    <div className="dc-art-head">
                      <div className="dc-art-titles">
                        <p className="dc-art-cat">{a.category}</p>
                        <h2 id={`${a.id}-t`}><a href={`#${a.id}`} onClick={(e) => { e.preventDefault(); openOne(a.id); history.replaceState(null, '', `#${a.id}`); }}><Hl text={a.title} q={hl} /></a></h2>
                        <p className="dc-art-sum"><Hl text={a.summary} q={hl} /></p>
                      </div>
                      {!q && (
                        <button type="button" className="dc-toggle" aria-expanded={isOpen} aria-controls={`${a.id}-body`} onClick={() => toggle(a.id)} data-testid={`button-toggle-${a.id}`}>
                          <span className="sr-only">{isOpen ? 'Collapse' : 'Expand'} {a.title}</span>
                          <ChevronDown className="h-5 w-5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div id={`${a.id}-body`} className="dc-art-body" hidden={!isOpen}>
                      {a.paragraphs.map((p, i) => <p key={i}><Hl text={p} q={hl} /></p>)}
                      {a.steps && <ol className="dc-steps">{a.steps.map((s, i) => <li key={i}><span><Hl text={s} q={hl} /></span></li>)}</ol>}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

        </div>
        {/* Hide rather than unmount: closing must not discard drafts, proposals or undo. */}
        <div ref={assistantPanel} id="assistant" className="dc-assistant-popup" role="dialog" aria-modal="false" aria-labelledby="assistant-title" hidden={!assistantOpen} data-testid="dialog-setup-assistant">
          <Assistant onCite={reveal} onClose={closeAssistant} />
        </div>
        <button ref={assistantLauncher} type="button" className="dc-assistant-launcher" aria-expanded={assistantOpen} aria-controls="assistant" aria-haspopup="dialog" onClick={() => assistantOpen ? closeAssistant() : setAssistantOpen(true)} data-testid="button-assistant-launcher">
          {assistantOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <MessageCircle className="h-5 w-5" aria-hidden="true" />}
          {assistantOpen ? 'Close assistant' : 'Ask VANTYR'}
        </button>
      </div>
    </AppShell>
  );
}

function Assistant({ onCite, onClose }: { onCite: (id: string) => void; onClose: () => void }) {
  const chat = useSetupChat();
  const [draft, setDraft] = useState('');
  const [last, setLast] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const over = draft.length > MAX;

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [chat.messages.length, chat.pending]);

  const submit = async (text: string) => {
    if (!text.trim() || text.length > MAX || chat.pending) return;
    setLast(text);
    const ok = await chat.send(text);
    if (ok) setDraft((d) => (d === text ? '' : d));
  };

  return (
    <section className="dc-chat" aria-labelledby="assistant-title">
      <div className="dc-chat-head">
        <button type="button" onClick={onClose} className="dc-assistant-close" aria-label="Close setup assistant" data-testid="button-close-assistant"><X className="h-5 w-5" aria-hidden="true" /></button>
        <h2 id="assistant-title">Setup assistant</h2>
        <p>Suggestions grounded in these docs. Not authoritative: check them against your own scene.</p>
      </div>
      <div className="dc-chat-body">
        <div className="dc-notice" data-testid="text-privacy-notice">
          <strong>Before you send</strong>
          <ul>
            <li>Pressing Send shares your typed message and the eight supported local preferences with an AI service. No video, snapshots, event history or zones are sent.</li>
            <li>Do not include names, addresses, confidential details or identifiable scene descriptions.</li>
            <li>Chat lives only in this page’s memory. Clearing it does not erase what the AI provider already processed.</li>
            <li>Suggestions apply only to this browser on this device. There is no organization-wide control.</li>
          </ul>
        </div>

        {chat.messages.length > 0 && (
          <div ref={logRef} className="dc-log" aria-live="polite" aria-label="Conversation" data-testid="log-chat">
            {chat.messages.map((m) => (
              <div key={m.id} className={`dc-msg ${m.role === 'user' ? 'dc-msg-user' : 'dc-msg-ai'}`} data-testid={`msg-${m.role}-${m.id}`}>
                <span className="dc-msg-who">{m.role === 'user' ? 'You' : 'Assistant'}</span>
                {m.content}
                {m.sources && m.sources.length > 0 && (
                  <div className="dc-src" aria-label="Sources">
                    {m.sources.filter((s) => TITLES[s]).map((s) => (
                      <a key={s} href={`#${s}`} onClick={(e) => { e.preventDefault(); onCite(s); }} data-testid={`link-cite-${s}`}>{TITLES[s]}</a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {chat.pending && (
          <div className="dc-pending" role="status" data-testid="status-chat-pending"><span>Asking the assistant. Nothing will change without your Apply.</span><span className="dc-pending-bar" aria-hidden="true" /></div>
        )}

        {chat.error && (
          <div className="dc-error" role="alert" data-testid="text-chat-error">
            {chat.error}
            {last && <div className="mt-2"><button type="button" className="dc-btn" disabled={chat.pending} onClick={() => submit(last)} data-testid="button-chat-retry"><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry last question</button></div>}
          </div>
        )}

        {chat.proposal && (
          <div className="dc-proposal" data-testid="card-proposal">
            <h3>Suggested change for this browser</h3>
            <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed" data-testid="text-proposal-reason">{chat.proposal.reason}</p>
            <div className="dc-diff" aria-label="Before and after">
              {(Object.keys(chat.proposal.changes) as (keyof SetupSettings)[]).map((k) => {
                const after = chat.proposal!.changes[k];
                if (after === undefined) return null;
                return (
                  <div key={k} className="dc-diff-row" data-testid={`diff-${k}`}>
                    <span className="font-medium">{SETTING_LABELS[k]}</span>
                    <span className="dc-diff-vals">
                      <span className="dc-before"><span className="sr-only">from </span>{formatSetting(k, chat.proposal!.before[k])}</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="dc-after"><span className="sr-only">to </span>{formatSetting(k, after)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="dc-btn dc-btn-blue" onClick={chat.apply} data-testid="button-proposal-apply">Apply to this browser</button>
              <button type="button" className="dc-btn" onClick={chat.dismiss} data-testid="button-proposal-dismiss"><X className="h-4 w-4" aria-hidden="true" />Dismiss</button>
            </div>
          </div>
        )}

        <div role="status" aria-live="polite">
          {(chat.status || chat.canUndo) && (
            <div className="dc-status" data-testid="status-chat">
              {chat.status}
              {chat.canUndo && <div className="mt-2"><button type="button" className="dc-btn" onClick={chat.undoChanges} data-testid="button-chat-undo"><Undo2 className="h-4 w-4" aria-hidden="true" />Undo applied change</button></div>}
            </div>
          )}
        </div>

        {chat.messages.length === 0 && (
          <details className="dc-example-questions">
            <summary>Example questions <span className="text-xs font-normal">(edit before sending)</span></summary>
            <div className="dc-starters">
              {STARTERS.map((s, i) => (
                <button key={i} type="button" className="dc-starter" onClick={() => { setDraft(s); inputRef.current?.focus(); }} data-testid={`button-starter-${i}`}>{s}</button>
              ))}
            </div>
          </details>
        )}

        <form onSubmit={(e) => { e.preventDefault(); submit(draft); }}>
          <label htmlFor="chat-input" className="sr-only">Your question</label>
          <textarea id="chat-input" ref={inputRef} className="dc-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Describe your trial without personal or confidential details." aria-describedby="chat-count" data-testid="input-chat"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(draft); } }} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span id="chat-count" className="dc-count" data-over={over} data-testid="text-chat-count">{draft.length}/{MAX}{over ? ' (too long)' : ''}</span>
            <div className="ml-auto flex gap-2">
              <button type="button" className="dc-btn" onClick={() => { chat.clear(); setLast(null); }} disabled={chat.messages.length === 0 && !chat.pending && !chat.error && !chat.proposal} data-testid="button-chat-clear"><Trash2 className="h-4 w-4" aria-hidden="true" />Clear chat</button>
              <button type="submit" className="dc-btn dc-btn-blue" disabled={!draft.trim() || over || chat.pending} data-testid="button-chat-send"><Send className="h-4 w-4" aria-hidden="true" />{chat.pending ? 'Sending' : 'Send'}</button>
            </div>
          </div>
        </form>
      </div>

      <details className="dc-ref" style={{ margin: '0 18px 18px' }}>
        <summary data-testid="toggle-settings-ref">Current preferences in this browser <ChevronRight className="h-4 w-4" aria-hidden="true" /></summary>
        <dl>
          {SETUP_KEYS.map((k) => (
            <div key={k} data-testid={`ref-${k}`}><dt>{SETTING_LABELS[k]}</dt><dd>{formatSetting(k, chat.prefs[k])}</dd></div>
          ))}
        </dl>
        <p className="dc-ref-note">Keep at most (event retention) is documented but only changeable in <Link href="/settings" className="underline">Settings</Link>, because it can remove history. The assistant never proposes it.</p>
      </details>
    </section>
  );
}
