# Architecture

This document answers the "first task" of the product specification: architecture, folder
structure, document schema, dependencies, rendering, persistence, iOS PWA strategy and the
Phase 1 checklist. It also records the decisions that deviate from the specification and why.

## 1. Starting point

The repository was empty. The project was scaffolded with `create-next-app` (Next.js 16, React 19,
TypeScript, Tailwind CSS 4, ESLint) and built up from there. Nothing existing was discarded.

## 2. Layers

```
 UI (React components)            src/components, src/app
        │  calls actions, reads state
 Session state (Zustand)          src/store          selection, history, zoom, save status
        │  applies pure operations
 Document model (pure TS + Zod)   src/document       schema, geometry, operations, migrations
        │                                  │
 Renderer (Konva)  src/render     Persistence (IndexedDB)  src/persistence
        │
 Export            src/export
```

Rules that keep this maintainable:

- `src/document` imports nothing from React, Konva or the browser. It is plain data and pure
  functions, which is why it is fully unit tested in Node.
- Every change to a project goes through `commit()` in the store, with a pure operation from
  `src/document/operations.ts`. Operations never mutate; unchanged slides are shared between
  versions, so an undo snapshot costs almost nothing.
- There is exactly one document-to-pixels function: `buildSurfaceContent` in `src/render/scene.ts`.

## 3. Folder structure

```
src/
  app/                    routes: / (dashboard), /editor?id=…, manifest, global styles, font faces
  document/               schema.ts  geometry.ts  factory.ts  operations.ts  migrations.ts  ids.ts
  render/                 scene.ts (Konva scene builder)  resources.ts (image cache)  fonts.ts  shapes.ts
  export/                 exporter.ts (render, verify, zip, download)  naming.ts
  persistence/            db.ts (IndexedDB)  assets.ts (import + validation)
  store/                  editorStore.ts
  components/
    ui/                   small design-system primitives (button, fields, dialog, sheet, menu)
    dashboard/            project list, new-project dialog
    editor/               EditorApp (desktop + phone shells), CanvasStage, panels, hooks, actions
  lib/                    tiny React helpers
public/                   sw.js, icons
tests/e2e.mjs             real-browser workflow test
```

## 4. Document schema (version 1)

Defined with Zod in `src/document/schema.ts`; the TypeScript types are inferred from it.

```ts
Project  { schemaVersion: 1, id, name, mode: "independent" | "seamless",
           width, height,               // size of ONE slide
           slides: Slide[],             // 1..20
           panorama: { background, elements },   // used in seamless mode
           assets: AssetRef[],          // id, name, mime, width, height, size (no binary data)
           createdAt, updatedAt }
Slide    { id, name, background, elements }
Background = { type: "solid", color } | { type: "transparent" }
Element  = base & (Image | Text | Shape)
base     { id, name, x, y, width, height, rotation, opacity, visible, locked }
Image    { assetId, flipX, flipY, cornerRadius }
Text     { text, fontFamily, fontSize, fontWeight, italic, fill, align, lineHeight, letterSpacing }
Shape    { shape: rect|ellipse|triangle|polygon|star|line|arrow, fill, stroke, strokeWidth, cornerRadius, sides }
```

Decisions:

- **Layer order is array order.** The specification sketches a `zIndex` field; a second source of
  truth for order is exactly how preview and export drift apart, so it was left out.
- **`x`/`y` are the top-left of the unrotated box; rotation is around the box center.**
- **Seamless mode stores elements once, in panorama coordinates.** Slides are slices of that
  panorama, so an element crossing a boundary is never duplicated or re-laid out.
- **Typed element variants instead of `properties: Record<string, unknown>`,** so every field is
  validated and type checked.
- **Migrations:** `migrations.ts` upgrades stored documents one version at a time and then validates.
  Documents from a newer app version and corrupted documents are refused with a readable error
  instead of being opened half-broken.

Planned schema growth (each is a new discriminated-union member or optional field plus a
migration): gradient/image backgrounds, video and audio elements with timing, groups, masks,
blend modes, filters, custom font references, animation.

## 5. Rendering architecture

- Konva is used imperatively (not through react-konva). `buildSurfaceContent(surface, resources)`
  turns a surface (one slide, or the whole panorama) into a Konva group.
- **The editor canvas, the slide thumbnails and the exporter all call that same function.** The
  exporter renders it into an off-screen stage at document pixel size; for a panorama it only
  offsets the group by the slice's `x`. Preview and export therefore cannot disagree on geometry.
- `src/document/geometry.ts` is the single source for surface sizes, slide offsets and export
  frames (`getSurfaces`, `getExportFrames`).
- On every document change the editor rebuilds the content group. This is simple and correct, and
  fast enough for Phase 1 projects; drags and resizes are handled natively by Konva and only
  committed to the document when the gesture ends. Per-node diffing is the planned optimisation
  once projects get heavy (video, many images).
- Text boxes have a fixed width and automatic height. Fonts are awaited (`document.fonts.load`)
  before text is measured, in the editor and in the exporter.
- Images are drawn "cover" style inside their frame (`coverCrop`), never stretched.

Why not react-konva: with two renderers (React tree for the editor, something else for export) the
"same geometry" rule has to be maintained by discipline. One imperative scene builder enforces it
by construction.

## 6. Persistence strategy

IndexedDB database `creative-carousel-studio` (via `idb`):

| Store         | Content                                                        |
|---------------|----------------------------------------------------------------|
| `projectMeta` | name, size, slide count, dates, cover thumbnail (dashboard)    |
| `projectDocs` | the full document JSON                                         |
| `assets`      | original image files as Blobs, shared between projects by id   |

- Autosave is debounced (700 ms), serialized, and never blocks editing. Pending changes are flushed
  on `visibilitychange`/`pagehide`, the last reliable moment before iOS suspends a PWA.
- Originals are stored untouched; all adjustments live in the document (non-destructive).
- Imported files are validated by signature (not by extension), decoded once to read their size,
  and limited to 40 MB / 12 000 px per side.
- Deleting a project removes only the assets no other project references.
- `navigator.storage.persist()` is requested so the browser is less likely to evict data.
- Supabase (auth, cloud sync, storage) is deliberately **not** in Phase 1. The persistence API in
  `db.ts` is the seam where a sync layer plugs in during Phase 4; documents already reference
  assets by id, which maps directly onto object storage.

## 7. iOS / PWA strategy

- `manifest.webmanifest` (standalone), 192/512/maskable icons, apple-touch-icon, `viewport-fit=cover`
  with safe-area padding, theme colors for light and dark.
- `public/sw.js` precaches both pages and every script, stylesheet and woff2 font they reference.
  Navigations are network-first with cache fallback; hashed static files are cache-first.
- Dashboard ↔ editor use **full page navigations** on purpose (the editor is `/editor?id=…`).
  Cached whole pages are robust offline; client-side route payloads are not. The two ESLint rules
  that object are switched off in `eslint.config.mjs` with this explanation.
- Fonts are self-hosted through `@fontsource` (all OFL-licensed), so text renders identically
  offline and in exports.
- Touch: pinch zoom and two-finger pan, tap to select, drag to move, double tap to edit text,
  long press for the context menu, larger handles on coarse pointers.
- Export offers the system share sheet when available, which is the way to save straight to Photos.
- Canvas size is capped below iOS Safari's 16.7 MP limit; slides are rendered one at a time.
- HEIC: iOS converts HEIC photos to JPEG itself when the file picker asks for JPEG/PNG/WebP.

## 8. Dependencies

| Package | Why |
|---|---|
| next, react, react-dom | app framework |
| tailwindcss | styling |
| konva | canvas scene graph, hit testing, transform handles |
| zustand | session state and history |
| zod | document validation |
| idb | promise wrapper for IndexedDB |
| jszip | ZIP packaging of exports |
| lucide-react | icons |
| @fontsource/* | self-hosted font files |
| vitest, fake-indexeddb, puppeteer-core (dev) | unit and end-to-end tests |

Not used yet, on purpose: **shadcn/ui** (the handful of primitives needed are in
`src/components/ui`; shadcn components can replace them later without touching the editor),
**react-konva** (see section 5), **Supabase**, **FFmpeg.wasm / WebCodecs** (Phase 3).

## 9. Phase 1 checklist

| Item | Status |
|---|---|
| Project setup, lint, type check, unit tests | done |
| PWA: manifest, icons, service worker, offline shell | done |
| Dashboard: create, search, rename, duplicate, delete, covers, dates | done |
| Document schema, validation, migrations | done |
| Canvas engine: select, move, resize, rotate, multi-select, smart guides, zoom, pan | done |
| Slide system: independent slides and seamless panorama | done |
| Image import (picker, drag and drop), flip, corner radius, frame crop | done |
| Text: inline editing, family, weight, italic, size, color, alignment, line height, letter spacing | done |
| Shapes: rectangle, ellipse, triangle, polygon, star, line, arrow | done |
| Layer panel: select, rename, reorder, lock, hide | done |
| Undo / redo, copy / paste / duplicate, keyboard shortcuts | done |
| Autosave and recovery after reload | done |
| JPG / PNG export, single or ZIP, 1× / 2×, progress, cancel, dimension verification | done |
| Phone layout with touch gestures | done (see limitations) |

## 10. How it was verified

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 30 unit tests (schema, geometry, slicing, operations, migrations, persistence, naming).
- `npm run test:e2e`: 36 checks in headless Chrome against the production build, including
  creating a 10-slide project, importing images, rejecting a fake image, typography, layer and
  slide reordering, undo/redo, canvas drag, inline text editing, reload persistence, ZIP export
  with pixel-size checks, **pixel checks that a bar crossing two slide boundaries lines up in the
  exported slices and matches the editor preview**, offline reload through the service worker, and
  the phone layout with emulated touch.

## 11. Known limitations (honest list)

- **Not tested on a real iPhone or in Safari.** All browser testing was Chrome, with phone
  emulation for the mobile layout. Installing to the Home Screen, the iOS keyboard during inline
  text editing, share-sheet export and memory behaviour with large photos still need a device pass.
- Local only: no accounts, no cloud sync, no project folders yet.
- No grouping, rulers, grid, or free crop/pan of an image inside its frame (the frame always
  center-crops). Resizing an image from a side handle shows a stretched preview until release.
- Backgrounds are solid or transparent; gradients come with Phase 2.
- Eight built-in font families; custom font upload is Phase 2.
- Seamless projects cannot be converted to independent ones (or back) after creation. In seamless
  mode slides can be added or removed at the end only.
- Undo history is per editing session and is not persisted.
- Images are decoded at full resolution; preview proxies and Web Worker decoding are not in yet,
  so many very large photos in one project will be heavy on phones.
- SVG import is not enabled (it needs sanitising first).
- Templates, stickers, brand kits, video, AI features: later phases, nothing stubbed in the UI.
