import { useEffect, useRef, useState } from 'react';

const BASE = `${import.meta.env.BASE_URL}api/hero-recording/`;
// Change with a newly published recording so existing viewers do not retain it.
const VERSION = '20261108-real-owned-frame';
const SRC = `${BASE}engine.mp4?v=${VERSION}`;
const POSTER = `${BASE}poster.jpg?v=${VERSION}`;

type Mode = 'pending' | 'video' | 'poster';

export function HeroEngine() {
  const [mode, setMode] = useState<Mode>('pending');
  const [loaded, setLoaded] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const userPausedRef = useRef(false);
  userPausedRef.current = userPaused;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const data = window.matchMedia('(prefers-reduced-data: reduce)');
    const conn = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    const decide = () => setMode(mq.matches || data.matches || conn?.saveData ? 'poster' : 'video');
    decide();
    mq.addEventListener('change', decide);
    data.addEventListener('change', decide);
    conn?.addEventListener('change', decide);
    return () => {
      mq.removeEventListener('change', decide);
      data.removeEventListener('change', decide);
      conn?.removeEventListener('change', decide);
    };
  }, []);

  useEffect(() => {
    if (mode !== 'video') return;
    const v = videoRef.current, root = rootRef.current;
    if (!v || !root) return;
    let visible = true;
    const sync = () => {
      if (visible && !document.hidden && !userPausedRef.current) v.play().catch(() => { setUserPaused(true); });
      else v.pause();
    };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); });
    io.observe(root);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      v.pause();
      v.removeAttribute('src');
      v.load();
    };
  }, [mode]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !userPaused;
    setUserPaused(next);
    if (next) v.pause(); else v.play().catch(() => setUserPaused(true));
  };

  return (
    <div ref={rootRef} className="he-root" data-testid="hero-recording">
      {mode === 'poster' ? (
        <img className="he-media" src={POSTER} alt="" aria-hidden="true" data-testid="img-hero-poster"
          onError={() => setError('Recording poster could not be loaded.')} />
      ) : (
        <video ref={videoRef} className="he-media" aria-hidden="true" muted loop playsInline autoPlay preload="auto"
          poster={mode === 'video' ? POSTER : undefined} src={mode === 'video' ? SRC : undefined}
          onLoadedData={() => { setLoaded(true); setError(null); }}
          onError={(e) => {
            const me = e.currentTarget.error;
            if (mode === 'video') setError(`Recording failed to load${me ? ` (media error ${me.code}${me.message ? `: ${me.message}` : ''})` : ''}.`);
          }}
          data-testid="video-hero-recording" />
      )}
      <div className="he-veil" aria-hidden="true" />
      <p className="sr-only" data-testid="text-hero-recording-description">
        Background: a recording of the VANTYR engine processing licensed stock footage of a woman walking indoors. It shows the
        source video, the frame the engine analysed with its person box and body landmarks, cropped person regions, and the raw
        numeric output. It is not your camera and not live. Details are in the footer under About the hero recording.
      </p>
      <div className="he-controls">
        {error && <span className="he-error" role="status" data-testid="status-hero-recording-error">{error}</span>}
        {mode === 'video' && loaded && !error && (
          <button type="button" className="he-btn" onClick={toggle} aria-pressed={userPaused}
            data-testid={userPaused ? 'button-hero-resume-motion' : 'button-hero-pause-motion'}>
            {userPaused ? 'Resume motion' : 'Pause motion'}
          </button>
        )}
      </div>
    </div>
  );
}
