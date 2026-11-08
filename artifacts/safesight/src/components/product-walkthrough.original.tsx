import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Play, Film } from 'lucide-react';

// Versioned so previously cached recordings cannot retain the former branding.
const asset = (name: string) => `${import.meta.env.BASE_URL}walkthrough/${name}?v=vantyr-20261108`;

/** No video bytes are requested until the visitor explicitly chooses playback. */
export function ProductWalkthrough() {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [conserve, setConserve] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const data = matchMedia('(prefers-reduced-data: reduce)');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const update = () => setConserve(motion.matches || data.matches || !!connection?.saveData);
    update();
    motion.addEventListener('change', update);
    data.addEventListener('change', update);
    return () => {
      motion.removeEventListener('change', update);
      data.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const pause = () => { if (document.hidden) video.current?.pause(); };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) video.current?.pause();
    });
    const target = video.current ?? region.current;
    if (target) observer.observe(target);
    document.addEventListener('visibilitychange', pause);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', pause);
      video.current?.pause();
    };
  }, [loaded, failed]);

  return (
    <div ref={region} className="grid min-w-0 gap-7 lg:grid-cols-[1.5fr_1fr]" data-testid="product-walkthrough">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-[hsl(262_60%_95%)] px-3 py-1 font-mono font-medium uppercase text-sim">Simulation</span>
          <span className="text-muted-foreground">Actual application recording · no camera footage · no audio</span>
        </div>
        {loaded && !failed ? (
          <video ref={video} controls playsInline preload="none" poster={asset('poster.jpg')}
            aria-label="VANTYR simulation walkthrough, with text equivalent alongside"
            aria-describedby="walkthrough-transcript" className="w-full rounded-2xl border border-[hsl(var(--rule))] bg-white"
            data-testid="walkthrough-video" onError={() => setFailed(true)}>
            <source src={asset('simulation-review.mp4')} type="video/mp4" onError={() => setFailed(true)} />
            <track kind="captions" src={asset('captions.vtt')} srcLang="en" label="English screen descriptions" default />
            Your browser cannot play this recording. Follow the illustrated steps alongside.
          </video>
        ) : (
          <div className="sheet overflow-hidden">
            <svg viewBox="0 0 640 360" role="img" aria-labelledby="walkthrough-scene-title" className="block w-full">
              <title id="walkthrough-scene-title">Illustrated simulation: a person box enters a configured image zone, creating a flag for a separate human review.</title>
              <rect width="640" height="360" fill="#f3f1eb" />
              <path d="M32 280H608M80 80H560V280H80Z" fill="none" stroke="#d6d5d0" />
              <rect x="350" y="180" width="190" height="110" rx="4" fill="#ebe4fa" stroke="#7143a3" strokeDasharray="7 5" />
              <text x="360" y="279" fontFamily="system-ui" fontSize="13" fill="#58317e">Bench A · configured zone</text>
              <g stroke="#2438df" fill="none" strokeWidth="3">
                <rect x="360" y="72" width="106" height="182" rx="4" />
                <circle cx="413" cy="104" r="14" />
                <path d="M413 118V184L389 235M413 184L437 235M413 138L385 166M413 138L442 165" />
              </g>
              <circle cx="413" cy="254" r="5" fill="#7143a3" />
              <text x="360" y="60" fontFamily="system-ui" fontSize="13" fill="#2438df">Illustrative person box</text>
              <rect x="32" y="30" width="135" height="29" rx="14" fill="#7143a3" />
              <text x="48" y="49" fontFamily="system-ui" fontSize="13" fill="white">SIMULATION</text>
              <rect x="32" y="105" width="240" height="121" rx="9" fill="white" stroke="#d6d5d0" />
              <text x="49" y="132" fontFamily="system-ui" fontSize="16" fill="#1b2030">Observation → human check</text>
              <path d="M49 151H246M49 168H219M49 185H238M49 202H180" stroke="#d6d5d0" strokeWidth="5" />
              <text x="32" y="328" fontFamily="system-ui" fontSize="13" fill="#535761">Schematic only. Not live telemetry or a safety verdict.</text>
            </svg>
            <div className="border-t border-[hsl(var(--rule))] p-4">
              {!failed && <button type="button" onClick={() => setLoaded(true)} className="btn-primary px-4 py-2 text-sm" data-testid="button-load-walkthrough"><Play className="h-4 w-4" />Load walkthrough video</button>}
              <p className="mt-2 text-xs text-muted-foreground" role={failed ? 'status' : undefined}>
                {failed ? 'Playback is unavailable. The steps alongside explain the same workflow; you can also try it in the monitor.' : conserve ? 'Motion or data saving is enabled. This illustration stays still; video loads only if you choose.' : 'No autoplay. The short video downloads only when requested; press play in the player to begin.'}
              </p>
              {failed && <button onClick={() => { setFailed(false); setLoaded(false); }} className="mt-2 text-sm text-lens underline">Try video again</button>}
            </div>
          </div>
        )}
      </div>
      <div id="walkthrough-transcript" className="self-center">
        <Film className="h-5 w-5 text-lens" aria-hidden="true" />
        <h3 className="mt-3 font-display text-2xl font-semibold">From scripted entry to human review.</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">This recording uses VANTYR’s own simulation controls, not a real detection result or an accuracy benchmark.</p>
        <ol className="mt-5 space-y-4 text-sm">
          <li><strong>1. Replay sustained entry.</strong> The app applies Bench A with a four-second dwell rule. A scripted person box moves into the image zone.</li>
          <li><strong>2. Read the flag.</strong> After sustained entry, the app saves a simulated zone observation. A flag is a reason to check, not verified danger.</li>
          <li><strong>3. Record a human check.</strong> In Events, record an outcome and mark the flag reviewed. Resolution is a separate, explicitly confirmed action.</li>
        </ol>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Box bottom-center is a 2D image position, not a floor measurement. Human entries remain separate from original evidence. No camera, snapshots, or personal information were recorded.</p>
        <Link href="/dashboard?source=simulation" className="btn-ghost mt-5 px-4 py-2 text-sm">Try the simulation yourself</Link>
      </div>
    </div>
  );
}
