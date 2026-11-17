# Phase 5 plan and progress (production)

This file is the handoff note for Phase 5. Read `ARCHITECTURE.md` first, then this file. Update
the "Progress" section after every finished checkpoint.

Scope, from `SPEC.md` section 23: security testing, performance optimization, iOS testing, browser
compatibility, error handling, recovery testing, accessibility, deployment, documentation.

## State before Phase 5

- Phases 1 to 4 are done (see `ARCHITECTURE.md`, `PHASE3_PLAN.md`, `PHASE4_PLAN.md`). Skipped for
  the initial release by the owner's decision: cloud sync, AI assistant, background removal.
- Document schema version 6, IndexedDB version 3. Everything is local to the device.
- Checks that must stay green: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:e2e` (seven files; their headers explain the setup).

## Rules that must not be broken

- Phase 5 changes behaviour only where a test or a measurement showed a problem. No redesign, no
  refactoring for its own sake.
- Every fix comes with the check that found the problem, so it cannot come back unnoticed.
- The app keeps working offline and without an account. A performance change may not cost
  offline use (there is a browser check for exactly that).
- No secret in client code. The app talks to its own origin only; the Content Security Policy
  states that, and the e2e suites run under it.
- Report honestly: what was only verified in desktop Chrome is listed as such.

## Checkpoints

### E1. Security testing - done
- Audit of what the app accepts from outside: every imported file is checked by its bytes, not its
  name (photos, videos, music, fonts, template files), with size limits; documents go through
  `parseProject`; there is no HTML injection point (no `dangerouslySetInnerHTML`, no `eval`).
- Response headers for every route (`next.config.ts`): Content Security Policy (own origin, blob
  and data only; no other origin; no `eval`), `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`.
- `npm audit --omit=dev`: 0 known vulnerabilities on 2026-11-17.

### E2. Performance optimization - done
- Measured first (`tests/perf-load.mjs`), then changed only what the numbers pointed at.
- Dashboard: the Templates, Assets and Brand kits tabs and the zip library are fetched on demand.
  JavaScript the dashboard needs up front went from 296 KB to 223 KB gzipped (976 KB to 730 KB
  uncompressed). What is left is React, Next, the schema validator and the dashboard itself.
- Editor page HTML asks for 174 KB gzipped up front (the editor itself was already loaded on
  demand); the zip library moved out of the editor chunk and is fetched when idle.
- On-demand code is reported to the service worker, so it is cached for offline use from the
  first visit on.

### E3. Error handling - done
- `src/persistence/errors.ts`: storage failures become a sentence a person can act on (device
  full, storage unavailable, blocked by another tab, data from a newer version).
- A failed save shows the reason next to the status, retries by itself every 5 seconds, offers
  "Retry", and the browser asks before the page is left while a save has failed.
- `src/app/error.tsx` and `global-error.tsx`: a crash while drawing a page shows a way forward.
- The database connection is released when another tab upgrades it, and reopened after the
  browser closes it.

### E4. Recovery testing - done
- Found and fixed: an edit made in the last 700 ms before a reload or tab close was lost (the
  asynchronous save never got to run). The document is now also queued for writing in the
  `pagehide` / hidden handler with an explicit commit (`saveProjectNow`).
- A project whose stored data is damaged opens a recovery screen that lists its saved versions;
  restoring one makes it the project again (`recoverProjectFromVersion`). Without versions the
  screen says so. The dashboard keeps working and can delete the damaged project.
- Unknown project or template ids give a clear message.

### E5. Accessibility - done
- axe-core (WCAG 2.1 A and AA) runs in `tests/e2e-phase5.mjs` on 13 screens: the four dashboard
  tabs, the new project dialog, the editor with nothing and with a shape selected, the export and
  version history dialogs, the editor on a phone-sized screen, a failed save, the recovery screen.
- Fixed what it found: muted text contrast (light theme `--muted` is now `#66635d`, at least
  4.89:1 on every surface colour), accessible names that did not contain the visible text (project
  cards, template cards, size presets), buttons inside `role="option"` (layers list is a plain
  list with `aria-current` now).
- Dialogs: focus moves in, Tab stays inside, Escape closes, focus returns to the opener.

### E6. Documentation - done
- `README.md`, `ARCHITECTURE.md` (section 14, Phase 5), this file, `IOS_TEST_CHECKLIST.md`.

### E7. iOS testing - needs the owner
- Cannot be done from the build machine. `IOS_TEST_CHECKLIST.md` lists what to try on an iPhone,
  including everything from Phase 4 and 5 that has only run in desktop Chrome.

### E8. Browser compatibility - needs the owner
- Only Chrome is available where the tests run. Safari and Firefox on the Mac need a manual pass
  (the same checklist works). Known by design: video export needs WebCodecs or falls back to
  real-time recording; the eyedropper exists only where the browser has one.

### E9. Deployment - needs a decision
- Not done: the hosting target is not decided. Notes for whoever does it are in `README.md`
  ("Deploying"). The security headers come from `next.config.ts`, so they need a host that runs
  Next (for example Vercel) or the same headers configured on a static host.

### Phone fixes after the first iPhone test (2026-11-17)

- **Blur under the iOS status bar.** iOS 26 Safari blurs page content under the status bar unless
  an opaque element is fixed to the top of the page. The editor now has a fixed strip exactly as
  tall as the status bar area, in the top bar's colour. **Only checked in Chrome; it needs a test
  on the iPhone.**
- **Selecting several objects by touch.** "Select multiple" on the canvas (phone layout): while it
  is on, taps on the canvas and in the layers list add or remove objects, like Shift on a desktop.
- **Sliders under number fields on touch screens** (size, rotation, font size, spacing, stroke,
  corner radius, border, shadow, gradient angle, layout gap), so values can be changed without the
  keyboard covering the canvas. A whole slider drag is one undo step. Position fields have none
  (objects are dragged), and with a mouse the panel is unchanged.
- **Version dates.** A version was dated when its thumbnail finished rendering, not when its state
  was taken, so an automatic version could be listed as newer than a manual one saved meanwhile.
  It is dated at capture now. Found through an intermittent failure of the recovery test.
- Verified: `tests/e2e-mobile.mjs` (21 checks, phone emulation in Chrome), recovery suite 5 runs in
  a row at 35/35, all other suites unchanged.

## Known limits of Phase 5

- Every automated check ran in desktop Chrome on Linux. Nothing here was verified on iOS, Safari
  or Firefox.
- The Content Security Policy allows inline scripts and styles (`'unsafe-inline'`), because the
  prerendered pages need them. It still blocks every other origin and `eval`.
- Page zoom is limited (`maximum-scale=1`) so iOS does not zoom into text fields and the canvas
  can own pinch zoom. This is the one axe rule that is switched off (`meta-viewport`).
- Accessibility was checked with axe-core and keyboard focus tests. No screen reader was used, and
  the canvas itself is not accessible to one: objects on it are reachable through the layers list
  and the properties panel, not by navigating the drawing.
- The last-moment save writes projects. A template being edited still relies on the normal save,
  so an edit in the last 700 ms before closing a template can be lost.
- The error pages (`error.tsx`, `global-error.tsx`) exist but no test makes a page crash to show
  them.
- Load size was measured, not runtime speed on a phone. No change was made to rendering speed.
- "Storage is full" was simulated by making writes fail, not by filling a real disk.

## Progress

- [x] E1. Security testing (2026-11-17)
- [x] E2. Performance optimization (2026-11-17)
- [x] E3. Error handling (2026-11-17)
- [x] E4. Recovery testing (2026-11-17)
- [x] E5. Accessibility (2026-11-17)
- [x] E6. Documentation (2026-11-17)
- [ ] E7. iOS testing (owner, with `IOS_TEST_CHECKLIST.md`)
- [ ] E8. Browser compatibility (owner: Safari and Firefox on the Mac)
- [ ] E9. Deployment (needs the hosting decision)

### How it was verified

- 177 unit tests (7 new: storage error wording, last-moment save, recovery from a version).
- `tests/e2e-phase5.mjs`: 35 checks (headers on four routes, the browser really blocking other
  origins, 13 axe scans, dialog focus, edit-then-reload, failed save with automatic and manual
  retry, damaged project with and without versions, unknown ids, tabs opening offline after one
  visit).
- All earlier suites run under the new Content Security Policy, including MP4 export with the
  WebAssembly encoder: 36/36, 28/28, 127/127, 51/51, 24/24, 38/38.

Notes for the next session: E7 to E9 need the owner. When results from the iPhone come back, fix
what they show, then decide the hosting target and deploy.
