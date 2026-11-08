/** The same reviewed guide and setting boundaries power documentation and AI context. */
export interface GuideArticle {
  id: string;
  title: string;
  category: string;
  summary: string;
  paragraphs: string[];
  steps?: string[];
  keywords?: string[];
}

export const GUIDE: GuideArticle[] = [
  {
    id: 'speech-review', title: 'Optional English speech review', category: 'Privacy',
    summary: 'Default-off local English transcription, context screening and uncertain human-review cues.',
    paragraphs: [
      'Camera-only use never requests a microphone or sends audio. Alert tones only play sound; they do not listen. In Monitor, select speech cue categories, choose Review consent and start, read the disclosure and explicitly agree for each session. Profanity is independently selectable and off by default; swearing alone is not a danger incident. No classroom, workplace or household enforcement policy is assumed.',
      'After session consent, quantized Whisper Tiny English and MobileBERT MNLI models and runtime files download from Hugging Face and jsDelivr. These public asset requests reveal normal connection information such as your IP address, not microphone audio. The microphone stays off until both models prepare. Model/runtime files may remain in the browser cache; cold starts require a network connection and tens of megabytes per model. Local processing makes no provider inference request and has no automatic cloud fallback.',
      'Microphone audio is captured in up-to-three-second 16kHz mono chunks and transcribed in a browser worker. A generic natural-language-inference model screens up to three recent transcript chunks with conservative quotation, negation and ordinary-task guards. Current phrase matches with weak or conflicting context remain review-only, never automatic response inputs. Audio, transcripts and cues remain in session memory, not browser storage, server storage, history, exports, logs or telemetry. Stop terminates the worker and releases the microphone. Public model caching never caches conversations. Everyone audible must know and agree where recording is permitted.',
      'The status distinguishes preparing the model with the microphone off, requesting permission, listening, local processing with capture paused, paused/unavailable and stopped. There is no queued recording during processing gaps, so speech in those gaps is missed. A new consent action is required after Stop, category changes, refresh, navigation, tab backgrounding, permission denial/revocation or interruption. Returning never silently resumes speech.',
      'Cues still require current literal English phrases for help, explicit harm statements, a few insults or optional profanity. The context model is generic NLI, not a trained abuse/intent classifier; its scores are not danger probabilities. Conservative guards can suppress genuine requests, while unrecognized quotes or routine requests can still cause false alarms. Low-signal chunks skip transcription using an energy gate, not voice recognition. English-only transcription cannot reliably identify other languages. Accents, noise and split phrases can cause errors. A timestamp locates a chunk, not a word. No cue is not evidence of safety.',
      'No camera frames are paired with audio. Speech never assigns a voice to a tracked person, infers identity, changes visual risk or resolves incidents. Separately enabled response actions may react to fresh context-supported help/threat cues. Uncertain context, profanity and insult cues cannot automatically trigger responses. Speech review is delayed and device-dependent, not guaranteed real-time or emergency monitoring.',
      'This experimental browser path requires WebAssembly, a secure connection, microphone permission, worker support and Web Audio PCM capture. It runs single-threaded WASM inference in a worker but still uses device CPU and can compete with camera processing. Slow inference times out visibly; no vendor speech-recognition API or cloud provider is substituted. Capture uses the older ScriptProcessor compatibility interface. Physical microphones, mobile performance and field accuracy of this new local path remain unvalidated. The previous cloud speech evaluation does not establish local model accuracy.',
    ],
    steps: ['Choose speech categories in Monitor; selecting or changing them does not access the microphone.', 'Read the model-download/privacy disclosure and agree for this session only.', 'Wait for local preparation, then allow the microphone. Read listening/processing status and review cues manually; speech during gaps is missed.', 'Press Stop speech review to release the microphone, terminate local processing and clear evidence. Restart only with fresh consent.'],
    keywords: ['microphone', 'audio', 'speech', 'profanity', 'threats', 'abuse', 'help', 'local', 'Whisper', 'privacy'],
  },
  {
    id: 'response-actions', title: 'Optional response actions', category: 'Monitoring',
    summary: 'Choose a moderate tone, a local spoken notice or a minimal browser webhook. Off by default.',
    paragraphs: [
      'Open Response actions in Monitor. Select live cue types and actions, then explicitly Enable for this tab. Eligible camera cues are sustained near-horizontal posture and configured image-zone dwell, not confirmed falls or harm. Scissors/knife labels and stabbing motions are not response triggers; the system does not recognize stabbing, pushing or malicious intent. The readiness display under the camera shows current tool labels, evidence availability and response enablement. Speech inputs must be new help/threat cues with model-supported context, not review-only/uncertain matches. Speech classification remains experimental and may be wrong. Simulations, historical cues, stale observations and numeric scores cannot trigger these actions. Each live batch has a 60-second global cooldown; suppressed cues are not queued.',
      'Tone is a short moderate-volume chime, not a siren. Spoken notice is fixed: An observation needs a human check. Please check the VANTYR monitor. Only locally installed English voices are used; unavailable voices fail visibly without a remote substitute. Audible actions end microphone capture before playback to prevent feedback. Restart speech only with fresh consent. The existing legacy audio-alert preference works separately when this new response layer is not active.',
      'Webhook sends only version, eventId, eventType, capturedAt, source and humanReviewRequired. No recordings, transcript/excerpts, images, scores, person labels, zone names or identity leave through this feature. The operator must supply a public HTTPS endpoint and acknowledge metadata sharing before Enable or Send test. The URL exists only in page memory and is masked in the UI. Public IP/connection metadata is still exposed to the endpoint.',
      'Delivery is a direct browser CORS JSON POST, not a server relay. The receiver must permit browser CORS requests. Credentials and referrers are omitted, redirects and automatic retries are disabled, and requests time out. Delivery unconfirmed may mean it already arrived; do not blindly retry. HTTP acknowledgement is not evidence that downstream action occurred. Stop aborts pending requests but cannot recall transmitted data.',
      'Configuration changes, consent withdrawal, backgrounding and navigation disarm responses; refresh starts off. Stop all cancels test/live playback and pending requests. Send test is an explicit, clearly labelled test: it preserves existing enabled/off status, never enables automatic monitoring by itself and does not reset the live cooldown. The session-only attempt list records pending/completed/unconfirmed/cancelled, not a human safety outcome. It is not saved to history or exported. Stopping is not resolution. Browser audio/network restrictions and closed/background tabs mean this is not a dependable emergency-response service.',
    ],
    steps: ['Open Response actions and choose cue types and actions.', 'For webhook, enter your HTTPS destination, preview the minimal JSON and acknowledge sharing.', 'Use Send test to verify your selected output. A test does not enable automatic responses.', 'Choose Enable for this tab for new live cues only. Stop all or change configuration to disarm.'],
    keywords: ['response', 'webhook', 'tone', 'spoken', 'reaction', 'outcome', 'CORS', 'privacy'],
  },
  {
    id: 'getting-started', title: 'Start with your camera', category: 'Getting started',
    summary: 'From opening the monitor to your first observation.',
    paragraphs: [
      'VANTYR is an experimental browser-based camera observation and human-review tool. It shows detected people and objects, body-posture evidence and time spent in a rectangle you configure. It is not a certified safety system or an emergency service.',
      'The Monitor opens stopped. Camera permission is requested only after you press Start. Live video is processed on this device, not recorded or uploaded. Model files download when camera inference starts. Keep the page visible and the device powered; browser interruptions can stop monitoring.',
      'Use a secure browser connection and allow camera permission. If permission is denied, use the browser’s site settings to allow access and retry. If no camera is available, use the clearly labeled simulation. Front/rear camera availability varies by device.',
    ],
    steps: ['Open Monitor and choose your camera under Camera options if needed. While stopped, Tool and motion review offers Balanced or experimental Detail object detection; Detail uses a fuller local model and close-up scans, with more download/CPU and no guaranteed accuracy gain.', 'Press Start camera, grant permission and wait for the on-device models to load.', 'Read the observation and its limitations. Tool review shows recent labels, uncertainty and image-motion trails, not learned stabbing/action recognition. Remote/toothbrush labels are never relabelled as scissors. Tool-motion observations do not trigger responses. Configure a zone only if it is useful for your scene.', 'Press Stop when finished. Review saved observations in Events. Tool trails are session-only and not saved.'],
  },
  {
    id: 'observations', title: 'Understand an observation', category: 'Monitoring',
    summary: 'What was seen, what is unknown, and what a person should check.',
    paragraphs: [
      'Observed, Not known and What to check are deliberately separate. Fresh on-device evidence differs from simulation and from saved events. “No configured rule triggered” is not a safety verdict. No observation, stale evidence or a stopped camera must never be interpreted as safe.',
      'Person boxes and posture are image-space evidence. Upright, tilted or horizontal posture and descriptive image movement do not establish a fall, push, running, injury or intent. VANTYR does not identify people or measure real-world distance.',
      'Technical details expose a configured heuristic score and its original evidence. Scores are not calibrated probabilities of harm. Model detection confidence is not safety confidence. Some sharp-looking objects may be labeled by the general object model; that is not a verified weapon or threat.',
      'Monitoring health describes evidence availability, not scene safety. Analysis API online refers to the optional snapshot service, not the camera’s readiness. When evidence is stale, interrupted or unavailable, check the camera/browser and use Restart camera.',
    ],
  },
  {
    id: 'simulation', title: 'Try the simulation', category: 'Getting started',
    summary: 'Explore the workflow without camera access.',
    paragraphs: [
      'Simulation uses scripted boxes and posture on an original schematic drawing, not real camera footage or live model measurements. It exercises the scoring and review workflow; it is not an accuracy benchmark.',
      'Try a brief crossing or sustained entry. Each replay starts a new simulated session with the Bench A zone and a four-second dwell rule. Brief entry stays below the threshold; sustained entry creates a flag for human review.',
      'Violet source labels identify simulation. Saved simulated events remain separate from live-camera observations. Snapshot analysis is disabled in simulation because it requires a real camera frame and consent.',
    ],
  },
  {
    id: 'zones', title: 'Set a zone', category: 'Monitoring',
    summary: 'Define an image rectangle and review sustained occupancy.',
    paragraphs: [
      'In Monitor, open Set a zone. Draw a rectangle on the image or use the numeric fields, give it a label, and choose the dwell duration. Changes take effect only when applied. Zone dimensions are normalized image coordinates, not real-world measurements.',
      'The tracked person-box bottom center must remain inside the configured image region long enough to meet its dwell rule. Borderline or unclear tracking is uncertain; timers restart rather than assume continuity. A stalled video invalidates timing evidence.',
      'A zone flag means sustained image-space occupancy, not verified danger, trespass, injury or assistance. Read its source, session, duration and uncertainty. A person leaving does not automatically resolve a flag.',
      'The assistant can explain zone setup but does not draw, apply or remove zones. Place a zone manually while looking at your actual scene. Confirm that the camera remains fixed and the region matches your intention.',
    ],
  },
  {
    id: 'review-events', title: 'Review and manage events', category: 'Human review',
    summary: 'Keep observations, human checks and resolution distinct.',
    paragraphs: [
      'Events are saved in this browser. Filter by source, event type or review status and expand an event to inspect the original observation and evidence. Timestamps describe when a record was created, not proof of when an injury occurred.',
      'For reviewable observations, record the human check and outcome. Mark reviewed after checking; resolution is a separate action with its own confirmation. If you cannot verify an outcome, record that uncertainty instead of inventing a result.',
      'Human review does not rewrite the original model or zone observation. The assistant cannot perform human checks, mark events reviewed/resolved, or delete records.',
      'Export JSON or CSV before removing records or changing retention. Deletion and clearing history cannot be undone by the assistant. The maximum-event preference trims older history when the next event is saved, so it is never changed by assistant proposals.',
      'Zone history groups saved records by source and session. Counts reflect workflow status, not injury counts, successful assistance, lifetime totals or model accuracy.',
    ],
  },
  {
    id: 'snapshot-privacy', title: 'Snapshot review and privacy', category: 'Privacy',
    summary: 'What stays on this device and what an optional AI request sends.',
    paragraphs: [
      'Live video is not recorded or uploaded. Optional snapshot review requires a fresh camera frame, a preview, explicit consent and a separate submission. Only the approved JPEG and optional context are sent to the analysis API; the returned assessment may be saved locally, not the image itself.',
      'Optional speech review is a separate, default-off cloud session with its own microphone consent, costs and non-retention boundaries. It never uses snapshot consent. See Optional English speech review before trying it.',
      'A single-image AI response can miss or misinterpret evidence. It is not continuous monitoring, emergency detection, medical advice or a verified outcome. Closing a pending review must not create a late history record.',
      'The Docs assistant sends the messages you type and the eight supported preference values to the AI service when you press Send. It does not receive video, snapshots, event history or zone geometry. Do not include personal information, confidential organization details or identifiable scene descriptions.',
      'Chat is kept in this page’s memory, not in a VANTYR conversation database or local storage. Clear chat or leave the page to remove the visible conversation. This does not delete data already sent to the AI provider, whose processing policies also apply.',
    ],
  },
  {
    id: 'camera-config', title: 'Camera and processing settings', category: 'Configuration',
    keywords: ['facingMode', 'minConfidence', 'intervalMs'],
    summary: 'Facing direction, confidence and processing interval.',
    paragraphs: [
      'Camera facing: Front (“user”) or Rear (“environment”). Default Front. A preference change applies on the next camera start; the assistant never opens or restarts a camera.',
      'Minimum confidence: 20–95%, default 50%. Detections below the threshold are excluded from scoring. Object risk rules also have their own minimum requirements. A higher value can hide real detections; a lower value can include more false positives. It is not a probability that an environment is safe.',
      'Frame interval: 40–1000 milliseconds, default 120ms. Lower values request more frequent processing and may use more battery or overload a slow device. Higher values reduce sampling frequency and can miss brief events. It does not change monitoring freshness thresholds. Evaluate on the actual device rather than assume a target frame rate.',
    ],
  },
  {
    id: 'display-config', title: 'Display and audio settings', category: 'Configuration',
    keywords: ['showBoxes', 'showPose', 'audioAlerts'],
    summary: 'Make the monitor easier to read without changing its evidence.',
    paragraphs: [
      'Bounding boxes: On by default. Shows object/person boxes and labels. Turning this off changes only the overlay, not scoring.',
      'Pose skeleton: On by default. Shows posture landmarks. Turning this off changes only the overlay, not posture processing or scoring.',
      'Audio alerts: Off by default. A short cue can play when a rule level rises to high or when a zone flag is created. Browser audio permissions, device volume and autoplay policies apply. Audio is not a guaranteed alarm or emergency notification. Applying this preference does not play a test tone.',
    ],
  },
  {
    id: 'logging-config', title: 'Logging and retention settings', category: 'Configuration',
    keywords: ['logThreshold', 'logCooldownSec', 'maxEvents'],
    summary: 'Choose which risk observations are saved locally.',
    paragraphs: [
      'Log from level: Low, Moderate (default), or High. This controls risk-record logging, not the underlying detections or whether the scene is safe. Choosing High can omit lower-level observations from history.',
      'Cooldown: 1–60 seconds, default 8 seconds. Minimum gap between risk records. Longer gaps reduce duplicates but can omit distinct nearby observations. Zone-episode logging has its own deduplication and is not a general risk-score log.',
      'Keep at most: 50–1000 events, default 300. Applied on the next saved event; older history above the limit is removed. This is configurable in Settings only, never by the assistant, because it can remove data. Export history first.',
      'All preferences apply to this browser/device, not every member of an organization. A successful save in one tab is visible to other tabs using the same origin; other browsers and devices do not share it.',
    ],
  },
  {
    id: 'organization', title: 'Plan a setup for your team', category: 'Setup guidance',
    summary: 'Choose a practical trial without implying organization-wide controls.',
    paragraphs: [
      'Start with the purpose of the trial: what a human wants to notice, where a fixed camera would look, who will check observations, and which devices are available. Use anonymous descriptions; no real names, addresses or confidential procedures are needed.',
      'The assistant can ask clarifying questions and recommend local display, sampling and logging preferences with trade-offs. Test in the labeled simulation, then validate the actual camera view and review process. No preset is certified or guaranteed to detect incidents.',
      'There are no organization accounts, role permissions, fleet configuration, shared event database, remote alerts or centrally enforced settings in this version. The assistant cannot apply a policy across an organization. Each browser must be configured and reviewed separately.',
      'Keep responsible human supervision and existing safety procedures. For immediate danger, use your organization’s emergency procedure rather than this application.',
    ],
  },
  {
    id: 'troubleshooting', title: 'Recover from common issues', category: 'Help',
    summary: 'Camera errors, slow devices, failed AI requests and damaged storage.',
    paragraphs: [
      'Camera denied: allow permission in the browser’s site settings, ensure another app is not using the camera and retry. Models unavailable: check the network needed to download model files; simulation can still explain the workflow. Stale/interrupted evidence: check that the tab and camera are active, then restart.',
      'Slow device: consider a larger frame interval, then check measured performance and evidence availability. Reducing overlays changes display only. Do not assume slower processing remains suitable for a safety use case.',
      'AI unavailable: documentation and manual Settings still work. Retry a failed assistant request explicitly; there is no automatic repeated billing or hidden fallback answer. The service may rate-limit requests.',
      'Storage blocked/full: changes are not saved. Free space or allow storage, then retry. Damaged local data is preserved until explicit recovery/reset; export the original data using the recovery controls before resetting. The assistant cannot reset, repair or overwrite it.',
    ],
  },
];

export type SetupSettings = {
  facingMode: 'user' | 'environment';
  minConfidence: number;
  intervalMs: number;
  showBoxes: boolean;
  showPose: boolean;
  audioAlerts: boolean;
  logThreshold: 'low' | 'moderate' | 'high';
  logCooldownSec: number;
};
export type SetupPatch = Partial<SetupSettings>;
export const SETTING_LABELS: Record<keyof SetupSettings, string> = {
  facingMode: 'Camera facing', minConfidence: 'Minimum confidence', intervalMs: 'Frame interval',
  showBoxes: 'Bounding boxes', showPose: 'Pose skeleton', audioAlerts: 'Audio alerts',
  logThreshold: 'Log from level', logCooldownSec: 'Logging cooldown',
};
export const SETUP_KEYS = Object.keys(SETTING_LABELS) as (keyof SetupSettings)[];
export function validSetupPatch(value: unknown): value is SetupPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key]) => !Object.hasOwn(SETTING_LABELS, key))) return false;
  return entries.every(([key, v]) => {
    switch (key) {
      case 'facingMode': return v === 'user' || v === 'environment';
      case 'minConfidence': return typeof v === 'number' && Number.isFinite(v) && v >= .2 && v <= .95;
      case 'intervalMs': return typeof v === 'number' && Number.isInteger(v) && v >= 40 && v <= 1000;
      case 'logCooldownSec': return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 60;
      case 'logThreshold': return v === 'low' || v === 'moderate' || v === 'high';
      default: return typeof v === 'boolean';
    }
  });
}
export function pickSetupSettings(prefs: SetupSettings): SetupSettings {
  return Object.fromEntries(SETUP_KEYS.map(key => [key, prefs[key]])) as SetupSettings;
}
export function formatSetting(key: keyof SetupSettings, value: SetupSettings[keyof SetupSettings]): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (key === 'facingMode') return value === 'user' ? 'Front' : 'Rear';
  if (key === 'minConfidence') return `${Math.round(Number(value) * 100)}%`;
  if (key === 'intervalMs') return `${value} ms`;
  if (key === 'logCooldownSec') return `${value} seconds`;
  return String(value);
}
