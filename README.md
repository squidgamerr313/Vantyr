# VANTYR — source export

A browser-first safety-intelligence proof of concept. Local object and posture
observations support human review; they are not verified harm or intent detection.

## Included

- React/Vite monitoring dashboard, event history, review workflow, settings and docs
- Local object, posture, tracking and optional experimental English speech processing
- API source, generated API contracts, shared libraries and application tests
- Dependency manifests and the pinned pnpm lockfile
- Authored SVG demo background and product icons

The original internal package and browser-storage names still use `safesight`.
That is intentional compatibility, not another product.

## Requirements

- Node.js 24 and pnpm 10 (`corepack enable` if your Node installation provides it)
- Linux x64 for the existing platform-specific lockfile overrides; other operating
  systems may require reviewing those overrides and regenerating the lockfile
- Internet access for the first browser-model download
- A modern browser; localhost or HTTPS for camera/microphone permissions

## Local development outside Replit

```sh
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm dev
```

Open **http://localhost:3000**. The included local launcher starts the frontend on
5173 and API on 8080, then forwards both through one localhost origin on 3000.
It does not enable cameras, microphones or responses. Stop with Ctrl+C.

Browser event history is local to that browser and origin, not a server database.
Use **Events → Load demo events** for explicitly labeled example review states.
Use the dashboard's labeled simulation for a repeatable workflow demonstration.

Checks:

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/safesight run typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/safesight exec node --test tests/demo-events.test.mjs tests/store.test.mjs
```

Research/replay and media-generation checks may require omitted datasets,
recordings, benchmark reports or external tools. The export is not a claim that
every research test can run without those inputs.

## Optional services

Core camera inference and the simulation do not require an LLM API key.
Optional Gemini still-image review and the typed setup assistant require a
configured Replit Gemini integration. The existing backend expects
`AI_INTEGRATIONS_GEMINI_API_KEY` and `AI_INTEGRATIONS_GEMINI_BASE_URL` in the
**server environment**. They are deliberately absent here. Never expose them
through frontend `VITE_` variables or commit a populated environment file.

The existing marketing-media route uses Replit App Storage and its credential
sidecar. It is not a portable storage configuration. Hero footage, walkthrough
recordings, posters and uploaded media are **not included**. Export-only media
fallback components avoid requesting these missing files. The original component
implementations are retained alongside them as `.original.tsx` files for reference.
Restore only media you have the right to publish, and configure storage separately.

Artifact manifests for the existing frontend and API are retained for reference.
Replit-managed integrations, storage, routing and publishing are not recreated by
uploading source to GitHub. No production database or stored user history is copied.

## Safety and privacy boundaries

- Sustained near-horizontal posture and configured image-zone dwell can suggest
  a human check; neither establishes a fall, injury, aggression or intent.
- Small-tool recognition can misclassify objects. There is no validated general
  malicious-intent or assault detector.
- Optional responses require separate enabling. Demo events do not dispatch them.
- Local inference downloads third-party model/runtime assets. Review their terms
  and network behavior before deployment.
- Optional snapshot review sends one explicitly approved still image to the
  configured provider; the setup chat sends typed messages and supported settings.

## Before uploading to GitHub

1. Extract this ZIP and upload **the extracted contents**, not the ZIP itself.
2. Start with a **private repository** if publication permissions are not settled.
3. Do not copy `.git`, `.env`, recordings, uploads, datasets, credentials or your
   original workspace's hidden directories into the repository.
4. Read `EXPORT-REPORT.json` and `RIGHTS-AND-THIRD-PARTY.md`.
5. Recheck any files you add after this export. The scan covers this snapshot only.

This export includes implementation source; it does **not** keep that
implementation confidential if you publish the repository publicly. It includes
no Git history and makes no claim about secrets in any older repository.
