import { cn } from '@/lib/utils';
import { useId } from 'react';

/**
 * Original schematic artwork for SafeSight. Everything here is illustrative:
 * no confidence numbers, no harm probabilities, no implied live telemetry.
 * Colors come from CSS variables so the art follows the theme.
 */

const INK = 'hsl(var(--ink))';
const LENS = 'hsl(var(--lens))';
const SIM = 'hsl(var(--sim))';
const RULE = 'hsl(var(--rule))';
const PAPER = 'hsl(var(--paper))';
const WARN = 'hsl(var(--warn))';

/** A person drawn as a pose skeleton. `lean` tilts the torso in degrees. */
function Figure({ x, y, s = 1, lean = 0, joints = false, faint = false }: { x: number; y: number; s?: number; lean?: number; joints?: boolean; faint?: boolean }) {
  const pts: [number, number][] = [[0, 0], [0, 26], [-18, 50], [20, 46], [2, 72], [-10, 118], [16, 118]];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={faint ? 0.45 : 1}>
      <g transform={`rotate(${lean} 2 72)`} stroke={INK} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <circle cx="0" cy="-12" r="11" fill={PAPER} />
        <path d="M0 0 L2 72 M0 26 L-18 50 M0 26 L20 46" />
      </g>
      <path d="M2 72 L-10 118 M2 72 L16 118" stroke={INK} strokeWidth={3.2} strokeLinecap="round" fill="none" />
      {joints && pts.map(([px, py], k) => (
        <circle key={k} cx={px} cy={py} r={3.6} fill={PAPER} stroke={LENS} strokeWidth={2}
          transform={k < 5 ? `rotate(${lean} 2 72)` : undefined} />
      ))}
    </g>
  );
}

export type SceneLayer = 'frame' | 'detect' | 'zone' | 'review';
const ORDER: SceneLayer[] = ['frame', 'detect', 'zone', 'review'];

/**
 * The landing scene: image-space person boxes, posture evidence, a configured
 * zone and a human review card. `upTo` controls which layers are shown, so the
 * workflow steps can reveal them one at a time under user control.
 */
export function MonitoringScene({ upTo = 'review', className, title = 'Schematic of VANTYR annotating a workshop frame' }: { upTo?: SceneLayer; className?: string; title?: string }) {
  const uid = useId();
  const lvl = ORDER.indexOf(upTo);
  const on = (l: SceneLayer) => ORDER.indexOf(l) <= lvl;
  return (
    <svg viewBox="0 0 640 400" className={cn('block h-auto w-full', className)} role="img" aria-labelledby={`${uid}-title ${uid}-desc`}>
      <title id={`${uid}-title`}>{title}</title>
      <desc id={`${uid}-desc`}>Two illustrative people in an image frame. {on('detect') ? 'Rectangles mark 2D image positions; joint dots and a torso angle show posture evidence. ' : ''}{on('zone') ? 'A dashed rectangle marks Bench A, a configured image zone. ' : ''}{on('review') ? 'A card asks for a separate human review. ' : ''}Schematic only, not real output.</desc>
      <defs>
        <pattern id={`${uid}-floor`} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke={RULE} strokeWidth="1" />
        </pattern>
      </defs>
      {/* frame */}
      <rect x="0.5" y="0.5" width="639" height="399" rx="14" fill="hsl(var(--surface))" stroke={RULE} />
      <rect x="1" y="250" width="638" height="149" fill={`url(#${uid}-floor)`} opacity=".8" />
      <path d="M1 250 H639" stroke={RULE} />
      {/* shelving and bench, drawn as plain line work */}
      <g stroke={INK} strokeOpacity=".28" strokeWidth="1.5" fill="none">
        <path d="M40 90 H170 M40 140 H170 M40 190 H170 M48 82 V250 M162 82 V250" />
        <rect x="58" y="112" width="26" height="28" /><rect x="92" y="120" width="38" height="20" /><rect x="64" y="166" width="44" height="24" />
        <path d="M370 210 H560 M380 210 V262 M550 210 V262 M392 190 h40 v20 M470 196 h28 v14" />
      </g>
      {/* corner brackets: camera frame */}
      <g stroke={INK} strokeOpacity=".55" strokeWidth="2" fill="none">
        <path d="M16 36 V16 H36 M604 16 H624 V36 M16 364 V384 H36 M624 364 V384 H604" />
      </g>
      <g fontFamily="Geist Mono, monospace" fontSize="10" fill={INK} fillOpacity=".8">
        <text x="44" y="30">CAMERA FRAME / 2D IMAGE</text>
      </g>

      <Figure x={240} y={128} s={1.05} lean={on('detect') ? 24 : 24} joints={on('detect')} />
      <Figure x={470} y={150} s={0.92} joints={on('detect')} />

      {on('detect') && (
        <g className="scene-layer">
          <rect x="198" y="102" width="98" height="152" fill="none" stroke={LENS} strokeWidth="2" rx="2" />
          <rect x="198" y="88" width="56" height="14" fill={LENS} />
          <text x="203" y="98.5" fontFamily="Geist Mono, monospace" fontSize="9.5" fill={PAPER}>person 1</text>
          <rect x="446" y="126" width="54" height="136" fill="none" stroke={LENS} strokeWidth="2" rx="2" />
          <rect x="446" y="112" width="56" height="14" fill={LENS} />
          <text x="451" y="122.5" fontFamily="Geist Mono, monospace" fontSize="9.5" fill={PAPER}>person 2</text>
          {/* torso angle evidence */}
          <path d="M242 204 V150" stroke={INK} strokeDasharray="3 4" strokeWidth="1.4" />
          <path d="M242 168 A36 36 0 0 1 257 171" fill="none" stroke={WARN} strokeWidth="2" />
          <g transform="translate(306 150)">
            <path d="M-8 18 H-2" stroke={WARN} strokeWidth="1.4" />
            <rect x="0" y="6" width="112" height="34" rx="5" fill={PAPER} stroke={RULE} />
            <text x="8" y="20" fontFamily="Geist Mono, monospace" fontSize="9" fill={INK}>POSTURE EVIDENCE</text>
            <text x="8" y="33" fontFamily="Geist, sans-serif" fontSize="10" fill={INK} fillOpacity=".7">torso leaning from vertical</text>
          </g>
        </g>
      )}

      {on('zone') && (
        <g className="scene-layer">
          <rect x="364" y="200" width="204" height="96" fill={LENS} fillOpacity=".06" stroke={LENS} strokeWidth="1.8" strokeDasharray="7 5" rx="3" />
          <rect x="364" y="300" width="138" height="18" rx="3" fill={PAPER} stroke={LENS} strokeOpacity=".5" />
          <text x="371" y="312.5" fontFamily="Geist Mono, monospace" fontSize="9.5" fill={LENS}>ZONE / BENCH A / 4 s</text>
          <circle cx="473" cy="262" r="4.5" fill={LENS} />
          <path d="M473 262 v-6" stroke={LENS} strokeWidth="1.5" />
          <text x="482" y="278" fontFamily="Geist, sans-serif" fontSize="9.5" fill={INK} fillOpacity=".8">box bottom-center inside zone</text>
        </g>
      )}

      {on('review') && (
        <g className="scene-layer" transform="translate(40 280)">
          <rect x="0" y="0" width="236" height="96" rx="10" fill={PAPER} stroke={INK} strokeOpacity=".7" strokeWidth="1.3" />
          <text x="14" y="21" fontFamily="Geist Mono, monospace" fontSize="9" fill={INK} fillOpacity=".8">HUMAN CHECK</text>
          <text x="14" y="40" fontFamily="Geist, sans-serif" fontSize="12" fontWeight="600" fill={INK}>Observation needs a person to look</text>
          <rect x="14" y="56" width="66" height="26" rx="13" fill={INK} />
          <text x="47" y="73" textAnchor="middle" fontFamily="Geist, sans-serif" fontSize="10.5" fill={PAPER}>Review</text>
          <rect x="88" y="56" width="92" height="26" rx="13" fill="none" stroke={INK} strokeOpacity=".5" />
          <text x="134" y="73" textAnchor="middle" fontFamily="Geist, sans-serif" fontSize="10.5" fill={INK}>Human outcome</text>
        </g>
      )}

      <g transform="translate(548 352)">
        <rect x="0" y="0" width="76" height="22" rx="11" fill={PAPER} stroke={SIM} strokeOpacity=".55" />
        <text x="38" y="14.5" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="9.5" fill={SIM}>SCHEMATIC</text>
      </g>
    </svg>
  );
}

export type StateKind = 'events' | 'camera' | 'empty' | 'no-camera' | 'permission' | 'error' | 'loading' | 'storage' | 'filtered';

/** Compact, product-specific empty and status artwork. Decorative: pair with text. */
export function StateIllustration({ kind: k = 'events', className }: { kind?: StateKind; className?: string }) {
  const kind = k === 'events' ? 'empty' : k === 'camera' ? 'no-camera' : k;
  return (
    <svg viewBox="0 0 160 104" className={cn('h-auto w-40', className)} aria-hidden="true" focusable="false">
      <rect x="10" y="10" width="140" height="84" rx="10" fill="hsl(var(--surface))" stroke={RULE} />
      <path d="M22 26 V20 H30 M130 20 H138 V26 M22 78 V84 H30 M138 78 V84 H130" stroke={INK} strokeOpacity=".5" strokeWidth="1.6" fill="none" />
      {kind === 'empty' && <>
        <g stroke={RULE} strokeWidth="1.5"><path d="M40 40 H120 M40 52 H120 M40 64 H96" /></g>
        <circle cx="34" cy="40" r="2.5" fill={LENS} /><circle cx="34" cy="52" r="2.5" fill={RULE} /><circle cx="34" cy="64" r="2.5" fill={RULE} />
      </>}
      {kind === 'filtered' && <>
        <path d="M52 34 H108 L88 56 V72 L72 66 V56 Z" fill="none" stroke={LENS} strokeWidth="1.8" strokeLinejoin="round" />
      </>}
      {kind === 'no-camera' && <>
        <rect x="56" y="40" width="40" height="28" rx="4" fill="none" stroke={INK} strokeWidth="1.8" />
        <path d="M96 49 L110 42 V66 L96 59" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="76" cy="54" r="6" fill="none" stroke={LENS} strokeWidth="1.8" />
      </>}
      {kind === 'permission' && <>
        <rect x="56" y="40" width="40" height="28" rx="4" fill="none" stroke={INK} strokeWidth="1.8" />
        <path d="M96 49 L110 42 V66 L96 59" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M50 76 L116 32" stroke={WARN} strokeWidth="2.2" strokeLinecap="round" />
      </>}
      {kind === 'error' && <>
        <path d="M80 32 L106 76 H54 Z" fill="none" stroke={WARN} strokeWidth="2" strokeLinejoin="round" />
        <path d="M80 48 V62" stroke={WARN} strokeWidth="2.2" strokeLinecap="round" /><circle cx="80" cy="69" r="1.6" fill={WARN} />
      </>}
      {kind === 'storage' && <>
        <ellipse cx="80" cy="38" rx="22" ry="7" fill="none" stroke={INK} strokeWidth="1.8" />
        <path d="M58 38 V68 C58 72 68 75 80 75 C92 75 102 72 102 68 V38" fill="none" stroke={INK} strokeWidth="1.8" />
        <path d="M70 56 L90 56" stroke={WARN} strokeWidth="2.2" strokeLinecap="round" />
      </>}
      {kind === 'loading' && <>
        <rect x="40" y="34" width="80" height="8" rx="4" fill={RULE} />
        <rect x="40" y="50" width="56" height="8" rx="4" fill={RULE} />
        <rect x="40" y="66" width="68" height="8" rx="4" fill={RULE} />
        <rect x="40" y="34" width="28" height="8" rx="4" fill={LENS} fillOpacity=".55" className="state-shimmer" />
      </>}
    </svg>
  );
}
