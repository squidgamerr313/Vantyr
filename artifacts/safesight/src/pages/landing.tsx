import { useState } from 'react';
import { Link } from 'wouter';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowLeft, Camera, ScanEye, SquareDashed, UserCheck, Eye, FileWarning, Users } from 'lucide-react';
import { Logo } from '@/components/shell';
import { MonitoringScene, type SceneLayer } from '@/components/illustrations';
import { HeroEngine } from '@/components/hero-engine';
import { ProductWalkthrough } from '@/components/product-walkthrough';
import './landing.css';

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
function useReveal() {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? false as const : { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-60px' },
    transition: { duration: reduce ? 0 : 0.5, ease: EASE },
  };
}

const STEPS: { icon: typeof Camera; t: string; d: string; layer: SceneLayer }[] = [
  { icon: Camera, t: 'Connect a camera', d: 'Allow your browser to use a camera, or try the labelled simulation first. Live video is processed on your device, not uploaded.', layer: 'frame' },
  { icon: ScanEye, t: 'See the observations', d: 'Person and object boxes show what the models found in the image. Body landmarks show posture—not a verified action, injury or incident.', layer: 'detect' },
  { icon: SquareDashed, t: 'Set a zone', d: 'Draw a rectangle and choose a time limit. The app saves a flag when a tracked person’s box bottom-center stays inside that image zone for long enough. Depth is not measured.', layer: 'zone' },
  { icon: UserCheck, t: 'Review the flags', d: 'Open the evidence, record a human check and decide what follow-up is needed. A flag is not confirmed danger, and resolution always requires a person.', layer: 'review' },
];

function HowItWorks() {
  const fade = useReveal();
  const [i, setI] = useState(0);
  const step = STEPS[i];
  return (
    <section id="how" className="lp-dark py-20 md:py-28" aria-labelledby="how-title">
      <div className="mx-auto max-w-6xl px-5">
        <motion.h2 {...fade} id="how-title" className="lp-title">How it <span className="lp-grad-text">works</span></motion.h2>
        <motion.p {...fade} className="lp-title-sub">From your camera to an observation you can review. Select a step to explore.</motion.p>
        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <ol className="lp-steps">
            {STEPS.map((s, k) => {
              const active = k === i;
              return (
                <li key={s.t}>
                  <button type="button" onClick={() => setI(k)} data-testid={`button-step-${k}`} aria-pressed={active}
                    className={`lp-step ${active ? 'is-active' : ''}`}>
                    <span className="lp-step-n">0{k + 1}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-display text-xl font-semibold"><s.icon className="h-4 w-4 shrink-0 text-[hsl(190_95%_58%)]" aria-hidden="true" />{s.t}</span>
                      <span className={`lp-step-desc block pt-1.5 text-[15px] leading-relaxed ${active ? '' : 'lp-step-clamp'}`}>{s.d}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="lg:sticky lg:top-8">
            <div className="lp-figure">
              <MonitoringScene upTo={step.layer} title={`Step ${i + 1}: ${step.t}`} />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">Step {i + 1} of {STEPS.length}: {step.t}. Schematic, not real output.</p>
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0} aria-label="Previous step" data-testid="button-step-prev" className="lp-icon-btn"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" onClick={() => setI((v) => Math.min(STEPS.length - 1, v + 1))} disabled={i === STEPS.length - 1} aria-label="Next step" data-testid="button-step-next" className="lp-icon-btn"><ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const WHY_ICONS = [Eye, FileWarning, Users];
const WHY = [
  ['See people and posture', 'View person and object boxes alongside body-posture landmarks. A near-horizontal torso is evidence to review—not a confirmed fall.'],
  ['Watch a zone you define', 'Mark part of the image and set a time limit. A sustained entry creates a flag. This is image position, not measured floor distance.'],
  ['Review what happened', 'Open an event, inspect the original evidence and record a human check. You decide what needs follow-up. Nothing is automatically declared safe.'],
];

const DEPEND = [
  ['Local camera processing', 'Camera frames are processed in your browser. Live video is not uploaded.'],
  ['Consent-based image review', 'An optional AI review sends one still image, only after you preview it and agree.'],
  ['Device performance', 'Frame rate and latency are measured on your device. Model loading and camera errors are shown in the monitor.'],
  ['Detection limitations', 'Experimental, not certified, and not a medical judgment. Smoke, fire and depth are not reliably detected. A low score does not establish safety.'],
];

export default function Landing() {
  const reduce = useReducedMotion();
  const fade = useReveal();
  const up = (d: number) => ({ initial: reduce ? false : { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay: d, duration: 0.55, ease: EASE } });
  return (
    <div className="lp min-h-[100dvh] overflow-x-clip">
      <div className="lp-dark lp-masthead">
      <a href="#main" className="skip-link" data-testid="link-skip">Skip to content</a>
      <header className="lp-header">
        <div className="lp-nav mx-auto max-w-7xl">
          <Logo inverse />
          <nav className="hidden gap-7 text-sm md:flex" aria-label="Sections">
            {[['how', 'How it works'], ['demo', 'Walkthrough']].map(([id, l]) => (
              <a key={id} href={`#${id}`} className="lp-nav-link inline-flex min-h-11 items-center" data-testid={`link-${id}`}>{l}</a>
            ))}
          </nav>
          <Link href="/docs" className="lp-nav-link inline-flex min-h-11 items-center px-1 text-sm md:-ml-3" data-testid="link-docs">Docs</Link>
          <Link href="/dashboard" className="lp-nav-cta" data-testid="link-open-dashboard">Open monitor</Link>
        </div>
      </header>
      </div>

      <main id="main" tabIndex={-1}>
        <section className="lp-hero lp-dark" aria-labelledby="hero-title">
          <HeroEngine />
          <div className="lp-hero-layout relative z-[1] mx-auto flex max-w-7xl flex-col items-center justify-center gap-8 px-5 text-center">
            <h1 id="hero-title" className="lp-slogan min-w-0" data-testid="text-headline">
              VANTYR
            </h1>
            <div className="lp-hero-copy min-w-0 max-w-3xl">
              <motion.p {...up(0.2)} className="lp-hero-lede">
                Safety intelligence. Built to help people respond.
              </motion.p>
              <motion.div {...up(0.28)} className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link href="/dashboard?source=simulation" data-testid="button-launch-demo" className="lp-cta">
                  Try the simulation <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a href="#how" className="link-underline py-3 text-sm font-medium" data-testid="link-how-hero">How it works</a>
              </motion.div>
              <motion.p {...up(0.34)} className="lp-hero-note mt-4 text-sm">On-device processing. No live video uploads. Experimental prototype.</motion.p>
            </div>
          </div>
        </section>

        <section id="why" className="lp-light" aria-labelledby="why-title">
          <div className="mx-auto max-w-6xl px-5 py-20 md:py-28">
          <motion.h2 {...fade} id="why-title" className="lp-title">What is <span className="text-lens">VANTYR?</span></motion.h2>
          <motion.p {...fade} className="lp-title-sub">A camera review tool that highlights observations for a person to check—not an automatic safety verdict.</motion.p>
          <dl className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-[1.2fr_1fr_1fr]">
            {WHY.map(([t, d], k) => {
              const Icon = WHY_ICONS[k];
              return (
                <motion.div key={t} {...fade} className="lp-card" data-testid={`card-why-${k}`}>
                  <span className="lp-card-icon" aria-hidden="true"><Icon className="h-5 w-5" /></span>
                  <dt className="mt-5 font-display text-2xl font-bold tracking-tight">{t}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed">{d}</dd>
                </motion.div>
              );
            })}
          </dl>
          </div>
        </section>

        <HowItWorks />

        <section id="demo" className="lp-light" aria-labelledby="demo-title">
          <div className="mx-auto max-w-6xl px-5 py-20 md:py-28">
          <motion.h2 {...fade} id="demo-title" className="lp-title">Watch it <span className="text-lens">run</span></motion.h2>
          <motion.p {...fade} className="lp-title-sub">The real app, running its labelled <span className="font-semibold text-sim">simulation</span>.</motion.p>
          <div className="lp-walk mt-10"><ProductWalkthrough /></div>
          <div className="mt-6"><Link href="/dashboard" data-testid="link-demo-monitor" className="link-underline inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-lens">Open the monitor to use your camera <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
          </div>
        </section>

        <section id="dependability" className="lp-dependability lp-dark" aria-labelledby="dep-title">
          <div className="mx-auto max-w-6xl px-5 py-20 md:py-28">
            <motion.h2 {...fade} id="dep-title" className="lp-title">Know the <span className="lp-grad-text">limits</span></motion.h2>
            <motion.p {...fade} className="lp-title-sub">What it does, and what it cannot.</motion.p>
            <dl className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
              {DEPEND.map(([t, d], k) => (
                <motion.div key={t} {...fade} className="lp-card lp-card--dark" data-testid={`card-limit-${k}`}>
                  <dt className="flex items-baseline gap-3 font-display text-xl font-bold tracking-tight"><span className="lp-num">0{k + 1}</span>{t}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed">{d}</dd>
                </motion.div>
              ))}
            </dl>
            <div className="mt-20 flex flex-wrap items-end gap-8 border-t border-[hsl(0_0%_100%/.15)] pt-12">
              <motion.h2 {...fade} className="lp-statement">Try <span className="lp-grad-text">VANTYR</span></motion.h2>
              <motion.div {...fade} className="flex flex-wrap items-center gap-6 md:ml-auto">
                <p className="max-w-xs text-sm text-muted-foreground">Start with the simulation. Switch to your camera when you are ready.</p>
                <Link href="/dashboard" data-testid="button-launch-demo-footer" className="lp-cta">Open the monitor <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              </motion.div>
            </div>
          </div>
          <footer className="border-t border-[hsl(0_0%_100%/.12)] py-7">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 text-xs text-muted-foreground">
              <span className="font-display text-base font-semibold text-foreground">VANTYR</span>
              <span className="sm:ml-auto">Experimental prototype. Not a certified safety system.</span>
              <a href="#engine-recording-description" className="link-underline" data-testid="link-hero-recording-about">About the hero recording</a>
            </div>
            <details id="engine-recording-description" className="lp-recording mx-auto mt-4 max-w-6xl px-5 text-xs text-muted-foreground" data-testid="details-hero-recording">
              <summary>About the hero recording</summary>
              <p>The hero background is a recorded run of the VANTYR vision engine and its production overlay, processing licensed stock footage. It is not your camera, not live, and not proof of accuracy. It was recorded with software graphics, so its timings are not a benchmark of device performance.</p>
              <p>Footage: <a href="https://www.pexels.com/video/a-woman-walking-inside-the-house-4098697/" target="_blank" rel="noopener noreferrer" data-testid="link-pexels-source">Pexels video 4098697 by Martina Tomsic</a>, used under the <a href="https://www.pexels.com/license/" target="_blank" rel="noopener noreferrer" data-testid="link-pexels-license">Pexels license</a>.</p>
            </details>
          </footer>
        </section>
      </main>
    </div>
  );
}
