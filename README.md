# Creative Carousel Studio

A browser-based studio for designing Instagram carousels: independent slides or one seamless
panorama that is sliced on export. Works on desktop and phones, installable as a PWA, and keeps
every project on the device (IndexedDB) so it opens offline.

**Status: Phase 1 (foundation and basic editor) is implemented and tested.**
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
npm run test:e2e     # real-browser workflow test, see the header of tests/e2e.mjs
```

## Try it on an iPhone

Service workers and "Add to Home Screen" need HTTPS (plain `http://192.168.x.x` is not enough).
Either deploy the build (for example to Vercel) or expose the local server through an HTTPS tunnel,
open the URL in Safari, then Share → Add to Home Screen.

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
