# Creative Carousel Studio

A browser-based studio for designing Instagram carousels: independent slides or one seamless
panorama that is sliced on export. Works on desktop and phones, installable as a PWA, and keeps
every project on the device (IndexedDB) so it opens offline.

**Status: Phases 1 to 4 are implemented and tested, except cloud sync, the AI assistant and
background removal, which are left out of the initial release. Phase 5 (production) is done for
security, performance, error handling, recovery, accessibility and documentation; testing on an
iPhone and in Safari / Firefox, and deployment, are still open (see
[PHASE5_PLAN.md](./PHASE5_PLAN.md) and [IOS_TEST_CHECKLIST.md](./IOS_TEST_CHECKLIST.md)).
Automated checks run in desktop Chrome only.**
See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design, the full feature status and known limitations.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000 (no service worker in dev)

npm run build
npm run start        # production build, service worker and offline shell active
```

## Check it

```bash
npm run typecheck
npm run lint
npm test             # unit tests: document model, geometry, migrations, persistence, naming
npm run test:e2e     # real-browser workflow tests (tests/e2e*.mjs), see their headers
node tests/perf-load.mjs   # JavaScript each page loads up front (needs the production server)
```

## Try it on an iPhone

Service workers and "Add to Home Screen" need HTTPS (plain `http://192.168.x.x` is not enough).
Either deploy the build (for example to Vercel) or expose the local server through an HTTPS tunnel,
open the URL in Safari, then Share → Add to Home Screen.

## Deploying

Not done yet; the hosting target is open. Things to know:

- The app is two prerendered pages (`/` and `/editor`) plus static files. All data stays in the
  browser (IndexedDB); there is no server state, database or secret.
- It must be served over HTTPS, otherwise there is no service worker and no "Add to Home Screen".
- The security headers (Content Security Policy and others) are set in `next.config.ts`. A host
  that runs Next, such as Vercel, sends them as they are. On a plain static host the same headers
  have to be configured there.
- After a deploy, users get the new version on the next online start. Projects are not touched by
  an update; the document schema and the database migrate forward on their own.
- Storage belongs to the origin: changing the domain means an empty app for existing users.

## If something goes wrong

- "Not saved" next to the project name: the reason is shown beside it. The app retries by itself
  and "Retry" does it at once. Free space in the Assets tab (filter "Unused") if the device is full.
- "Could not open this project": the screen lists the project's saved versions; "Restore" makes
  one of them the project again.
- A blank or broken screen after an update: close every tab of the app and open it again.

## What Phase 1 contains

- Dashboard: create (presets or custom size, slide count, seamless or independent), search, rename,
  duplicate, delete, covers, last-modified dates
- Editor: text, 7 shapes, images (upload or drag and drop), move / resize / rotate, smart guides,
  multi-select, copy / paste / duplicate, lock, hide, align to slide, zoom and pan, inline text editing
- Slides: add, delete, duplicate, reorder, rename; seamless panoramas with boundary indicators
- Layers panel: select, rename, reorder (buttons or drag), lock, hide
- Undo / redo (100 steps), non-blocking autosave with status indicator
- Export: JPG or PNG, 1× or 2×, one slide or all slides as an ordered ZIP, progress and cancel
- PWA: manifest, icons, offline shell, self-hosted fonts
- Phone layout: bottom toolbar, bottom sheets, pinch zoom, two-finger pan, long-press menu

## What Phase 2 adds

- Fonts: 28 built-in families in 8 categories, custom font upload (TTF, OTF, WOFF, WOFF2) stored on
  the device and restored on every start, font picker with search, favorites, recents, rename,
  weight and style mapping
- Text: letter case, outline, background box, drop shadow
- Photos: 14 non-destructive adjustments, 10 filter looks, your own saved presets, 7 mask shapes,
  borders, shadows, replace photo
- Backgrounds: linear and radial gradients with up to 6 colors
- Stickers and doodles (18), film grain / light leak / vignette overlays, blend modes on every layer
- Templates: 22 fully editable Photo Journal templates (4:5, 1:1 and 9:16) with empty frames that
  take photos or videos, filters by ratio and length, favorites, and "Save as template" for your
  own projects
- Brand kits: colors, heading and body fonts, logos; attach a kit to a project to get its swatches,
  text styles and logos in the editor
- Colors: recent colors, brand swatches, eyedropper where the browser has one
