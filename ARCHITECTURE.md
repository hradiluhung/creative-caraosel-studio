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
  document/               schema.ts  geometry.ts  factory.ts  operations.ts  migrations.ts  ids.ts  timing.ts (video time model)
  render/                 scene.ts (Konva scene builder)  resources.ts (image cache)  fonts.ts  shapes.ts
                          videoPool.ts (playing videos, poster frames)  videoDom.ts  musicPlayer.ts
  export/                 exporter.ts (render, verify, zip, download)  naming.ts
                          video.ts (MP4 per slide)  frameSource.ts (decoded frames)  videoSupport.ts
  persistence/            db.ts (IndexedDB)  assets.ts (import + validation)  video.ts  audio.ts  videoSniff.ts
                          proxy.ts (light preview copies of heavy videos)
  store/                  editorStore.ts
  components/
    ui/                   small design-system primitives (button, fields, dialog, sheet, menu)
    dashboard/            project list, new-project dialog
    editor/               EditorApp (desktop + phone shells), CanvasStage, panels, hooks, actions
  lib/                    tiny React helpers
public/                   sw.js, icons
tests/e2e*.mjs            real-browser workflow tests (one file per phase)
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
| `projectVersions` | earlier states of a project (Phase 4, database version 3)  |

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
| mediabunny | video export (decodes source frames, encodes H.264, writes MP4) and preview proxies |
| @mediabunny/aac-encoder | WebAssembly AAC encoder, so sound does not depend on the browser's encoders |
| lucide-react | icons |
| @fontsource/* | self-hosted font files |
| vitest, fake-indexeddb, puppeteer-core (dev) | unit and end-to-end tests |

Not used yet, on purpose: **shadcn/ui** (the handful of primitives needed are in
`src/components/ui`; shadcn components can replace them later without touching the editor),
**react-konva** (see section 5), **Supabase**, **FFmpeg.wasm** (WebCodecs does the encoding in Phase 3; no WebAssembly encoder is shipped).

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

## 11. Phase 2: professional design features

Schema version 2 (migration `1 -> 2` in `migrations.ts` fills neutral defaults, so Phase 1
projects open unchanged):

- `Background` gains `linear` (CSS-style angle) and `radial` gradients with 2 to 6 stops.
- Every element gains `blendMode` and an optional `shadow`.
- `Text` gains `transform` (letter case, applied at render time only), outline and a background box.
- `Image` gains `adjustments` (14 values, all 0 when neutral), `filter` (display name only),
  `mask`, border, and a nullable `assetId`: `null` is an empty **photo placeholder**.
- New element types `sticker` (key into `src/render/stickers.ts` plus a color) and `overlay`
  (grain, light leak, vignette).
- `Project.brandKitId`.

Decisions:

- **A filter is a named set of adjustments, never baked pixels.** `src/render/adjust.ts` is a pure
  function over an RGBA byte array (unit tested in Node, ready to move into a Web Worker). Grain
  uses a seeded PRNG so preview and export get the same noise.
- **Processed bitmaps are memoized** in `ImageStore.getProcessed` (keyed by asset, frame size, flips,
  adjustments and output size). The editor caps them at 1600 px, thumbnails render tiny ones, the
  exporter asks for full resolution. Blur and sharpen radii are relative to the bitmap size, so the
  look is the same at every resolution.
- **Sliders stay responsive through progressive rendering** (`ImageStore.getProcessed` with
  `progressive: true`, editor only). While a slider moves, only a 360 px preview is recomputed on
  the main thread; 140 ms after it stops, the full-resolution pass runs in a Web Worker
  (`src/render/adjust.worker.ts`) and replaces the preview. The cropped, resampled photo is cached
  per frame, so a slider step never resamples the original again. If the worker cannot start
  (for example offline before its script was cached), the same pass runs on the main thread.
  Measured with `tests/perf-slider.mjs` (12 MP photo, CPU throttled 4x, per slider step):
  brightness 262 ms -> about 65 ms, blur 1361 ms -> about 120 ms, vignette 1631 ms -> about 135 ms.
  The editor canvas also dropped its blurred backdrop shadow, which made every redraw about 3x
  cheaper in the same test.
- **Images are drawn as a pattern fill of their mask outline**, which is why border and shadow follow
  any mask shape with no extra code per shape.
- **Custom fonts:** files are checked by signature, loaded through `FontFace` (a corrupted file fails
  here and is rejected), stored as Blobs in the `fonts` store and re-registered by
  `loadCustomFonts()` before the editor opens a project. Documents store a stable family name;
  renaming only changes the label. A custom family can never shadow a built-in one. Fonts live in
  this app only: a web app cannot install fonts system-wide.
- **Templates are project documents.** Built-ins are functions in `src/templates/builtin.ts` that
  return a document; user templates are stored documents. Using one is `cloneProject` with fresh
  ids. Adding a template (also for a future admin tool) means adding one entry to a list. Placeholders
  are drawn in the editor and thumbnails, and left out of exports (the export dialog says so).
- **Brand kits** are their own store. Their logos are ordinary assets, and deleting a project never
  removes an asset a template or brand kit still uses.
- Database version 2 adds the `fonts`, `templates` and `brandKits` stores (existing data untouched).
  Favorites, recents and saved filter presets are per-device preferences in `localStorage`.

Phase 2 verification: 54 unit tests in total, plus `tests/e2e-phase2.mjs` (24 checks in Chrome):
gradient colors in the exported PNG, black-and-white filter and ellipse mask in exported pixels,
stickers, overlays, text effects, custom font upload surviving a reload, a rejected corrupted font,
brand kit with custom font and logo, template preview and use, filling a placeholder, and saving a
project as a template.

## 12. Phase 3: video

`PHASE3_PLAN.md` is the working plan and progress log. All four checkpoints are implemented: **C1 video as
an element, C2 the timeline, C3 video export, C4 background music and polish.** Verified in desktop
Chrome; see the plan for what still needs a real phone.

Schema version 3 (migration `2 -> 3` only bumps the version), then version 4 (`3 -> 4` gives every
clip `start: 0`) and version 5 (`4 -> 5`, optional `Slide.audio`):

- New element type `video`: `assetId`, `start`, `trimStart`, `trimEnd`, `volume`, `muted`, `playbackRate`,
  `loop`, `posterTime`, plus the frame styling images have (`mask`, `cornerRadius`, flips, border).
- `Slide.duration` (seconds, optional) and `AssetRef.duration` (video and audio assets).
- `Slide.audio`: background music with `start`, trim, `volume`, `fadeIn`, `fadeOut`, `loop`.

Decisions:

- **One time model, in `src/document/timing.ts`.** `videoTimeAt(element, slideTime)` says which source
  frame belongs to a moment of the slide (trim, speed, loop, hold on the last frame). The preview uses
  it now; the timeline and the exporter must use the same function.
- **Video goes through the same scene builder as everything else.** `ImageStore.videos` (a `VideoPool`)
  hands the scene builder a canvas with the element's current frame, already cropped to its box and
  flipped, exactly the shape `getProcessed` returns for photos. `scene.ts` uses it as the pattern fill
  of the mask outline, so masks, borders, shadows and blend modes work on video with no extra code.
  `BuildOptions.videoTime` selects the frame: undefined is the poster frame (thumbnails, image exports,
  the idle editor), a number is a slide time (playback now, video export later).
- **Poster frames are exact.** The frame at `posterTime` is captured by seeking a temporary `<video>`
  and cached; the small JPEG stored with the asset is only the instant fallback while that happens.
  Image exports wait for the exact frame and stop with a clear error if it cannot be read.
- **The video is the master during playback, not the wall clock.** A `Konva.Animation` advances the
  slide time, `VideoPool.sync` reports how far the leading clip really is and the clock is moved to it;
  a playing video is only seeked when it is far off. Forcing videos to chase a clock made playback
  stutter on phones. The canvas repaints when a video presents a frame (`requestVideoFrameCallback`),
  at a reduced pixel ratio while playing, and the video nodes are repainted in place without
  rebuilding the scene. Playback state is session state in the store; it never touches the document.
- **A clip is on screen only while it plays** (`clipActive`): from its `start` until one pass is over,
  or until the slide ends when it loops. That is what makes split work: the halves are two clips that
  follow each other. Poster mode (no `videoTime`) still shows every clip.
- **The timeline is a view of the document.** Every drag is an ordinary operation through `commit()`
  (coalesced into one undo step), computed by pure helpers in `timing.ts` (`trimClipStart`,
  `trimClipEnd`, `moveClip`, `splitClip`). Scrubbing only moves the session playhead (`canvasApi.seek`).
- **Playback starts inside the tap** (`canvasApi.togglePlayback`), because browsers only allow sound
  from a user gesture. If sound is refused anyway, the clip plays muted and the UI says so.
- **Import is validated like images:** file signature (not extension), `canPlayType`, a real decode to
  read size and duration, size and length limits, and a storage estimate check before writing.
- **Never wait for `loadeddata` alone.** iOS Safari loads no picture data for a video that is not
  playing, so `seekVideo` (`render/videoDom.ts`) asks for a frame by seeking and falls back to a
  moment of muted playback. Import only needs the metadata; the stored poster still is best effort.
- **Export draws every frame with the scene builder** (`src/export/video.ts`): the slide is built once
  on an off-screen stage at output size and only the video nodes are refreshed per frame, with
  `videoTime = frame / 30`. mediabunny does the media work: source frames are demuxed and decoded
  forward once with `VideoDecoder` (seeking a `<video>` per frame is an order of magnitude slower),
  H.264 is encoded with WebCodecs, and sound, mixed with `OfflineAudioContext`, is encoded by a
  bundled WebAssembly AAC encoder because the browsers' own AAC encoders were unreliable (silent files
  on a Mac and an iPhone, none at all in Chrome on Linux). Without WebCodecs the slide is
  recorded in real time with `MediaRecorder`. One file per slide, packaged in slide order; slides are
  never merged. The dialog reports what the device can really produce (feature detection in
  `videoSupport.ts`), and each MP4 is reopened to check its size, its duration and that its sound
  track is not silent.
- **Heavy sources get a preview proxy** (`persistence/proxy.ts`): above 720p or 8 Mbit/s, a 720p /
  30 fps copy is made in the background and played by the editor. Poster frames and exports always
  come from the untouched original (`VideoSource.previewUrl` is only used by the editor's pool).
- **A video slide is at most 60 seconds** (`MAX_VIDEO_SLIDE_SECONDS`, Instagram's limit per carousel
  video): enforced by the trim / move helpers and by `surfaceDuration`, not by the schema.
- **Music has one gain curve** (`trackGainAt` in `timing.ts`): the preview (`render/musicPlayer.ts`, an
  `<audio>` element kept in step with the clock) and the export (`mixAudio`, linear ramps between the
  curve's corner points) both follow it.
- **No filters on video.** The adjustment pipeline is per-pixel JavaScript (about 18 ms per 1080p
  frame for color, 240 ms with blur, on a desktop core): not real time. Video gets masks, borders,
  shadows, flips, opacity and blend modes.
- Live `<video>` elements exist only while a slide is playing or paused and are released on stop,
  because phones allow only a few video decoders at a time.

Verification: 100 unit tests in total; `tests/e2e-phase3.mjs` (115 checks in Chrome) covers import,
poster frames in editor and export pixels, playback, pause, trim, properties, mask, crop, flip, reload,
undo, the timeline (scrub, split, trim, move, zoom, slide length) and video export (mixed ZIP, frame
content, duration, sound track, fallback) and background music (import, waveform, fades measured in
the exported sound). `tests/perf-playback.mjs` is a
rough smoothness measurement for a slow phone.

## 13. Phase 4: advanced features

`PHASE4_PLAN.md` is the working plan and progress log. Done: **D1 version history, D2 asset library, D3 layouts, D4 template creator, D5 image tools.**
Skipped for the initial release: cloud sync, AI assistant, background removal.

- **Version history is local and document-only.** A version is the whole document JSON plus a
  thumbnail in the `projectVersions` store (database version 3). Documents are small because they
  only reference assets; what history really costs is that referenced assets stay stored.
- The rules are pure (`src/document/history.ts`): unnamed versions are pruned to the newest 20,
  named ones are kept; an automatic version is made on open and at most every ten minutes of editing.
- Restoring is a normal document change through `commit()` (undoable), and the state it replaces
  is saved first, so a restore can never lose work.
- Versions are opened through `parseProject`, like projects, so they survive schema changes.
- **The asset library is a view, not a new store.** Assets were already shared between projects by
  id; `listLibrary` adds usage (projects, templates, brand kits, versions) and the pure rules live in
  `src/persistence/libraryModel.ts`. Favorites and collections are optional fields on the stored
  asset and never enter a document. "From library" adds an `AssetRef` to the project, no copy.
- **Smart guides are pure geometry too** (`src/document/snapping.ts`). Targets are collected once
  per gesture: edges and centre of every slide, edges and centre of every other visible element
  (bounding box when rotated). `snapMove` handles dragging (box around the whole selection),
  `snapResize` handles the transformer (only the edges that follow the pointer; on a proportional
  corner resize the closer axis snaps and the other follows). The canvas applies them through
  Konva's `dragBoundFunc` and `boundBoxFunc`, so the snapped position is what Konva itself uses.
  Holding Ctrl or Cmd turns snapping off. Not snapped: resizing a single rotated element,
  rotation-aware edges, equal spacing between objects.
- **Document schema is version 6.** Image elements gained optional `crop`, `duotone` and `overlay`.
  Cropping is one pure function (`frameCrop`), the look is one pure function (`applyLook`), and
  both sit on the existing image path, so editor, thumbnails and export cannot differ.
- **A template is edited by the same editor.** Template mode only changes where autosave writes
  (`saveTemplateDoc` instead of `saveProject`) and hides version history. Template rules are pure
  (`src/templates/model.ts`); the template file format and its validation are in
  `src/templates/file.ts`, storage glue in `transfer.ts`.
- **Layouts are pure geometry** (`src/document/layouts.ts`): a kind, a count and an area give boxes.
  The editor turns boxes into placeholder image elements or moves the selected photos into them;
  the layout itself is not stored, the result is ordinary elements.

## 14. Phase 5: production

Plan, results and limits are in `PHASE5_PLAN.md`. What it added to the architecture:

- **Security headers** in `next.config.ts`, including a Content Security Policy that allows the
  app's own origin plus blob and data URLs and nothing else. The app never talks to another
  origin, and all e2e suites run under the policy.
- **Storage errors** are classified in one pure module (`src/persistence/errors.ts`). Autosave
  shows the reason, retries, and offers a manual retry.
- **Two saves.** The normal one is asynchronous and writes document, list entry and cover in one
  transaction. `saveProjectNow` is for the moment the page goes away: it queues the document write
  synchronously and commits explicitly, because a closing page never continues an async function.
- **Recovery** uses version history: `recoverProjectFromVersion` replaces a damaged project
  document with a saved version under the same project id (`RecoveryScreen.tsx`).
- **Loading on demand.** Dashboard tabs, the zip library and video export are separate chunks.
  `ServiceWorkerRegistration` reports loaded build files to the service worker
  (`cache-scripts` message), so on-demand code is available offline after the first visit.
- **Accessibility checks** (axe-core, WCAG 2.1 A and AA) are part of `tests/e2e-phase5.mjs`.

- **Groups (schema version 7).** Every element has an optional `groupId`; the element list stays
  flat. `src/document/groups.ts` holds the pure rules: grouping gathers members next to each other
  at the topmost member's place, a group of one is dissolved, copies get new group ids, and
  stacking moves whole blocks. The canvas selects a whole group on press, so the existing
  transformer moves it as one.
- **Slide deletion** (`removeSlide`) works for any slide. In seamless mode it cuts the slide's strip
  out of the panorama by the centre of each object or group.
- **Templates** are built from small helpers in `src/templates/kit.ts`; the photo journal set lives
  in `src/templates/journal.ts`.

## 15. Known limitations (honest list)

- **Video (Phase 3):** import was confirmed on an iPhone; playback smoothness there, the timeline, MP4
  export, music and preview proxies were only verified in desktop Chrome. No filters on video. On iOS the preview ignores volume and fades (the export applies
  them). Music needs a slide with video; a seamless panorama has no music track.
  Which codecs can be imported depends on the browser (for example HEVC MOV files play in Safari, not
  in every other browser); the import says so instead of failing silently.
- **Phase 2 was verified in desktop Chrome only.** Phase 1 has been used on an iPhone; the Phase 2
  panels, the iOS Files picker for fonts and filter speed on a phone still need a device pass.
- Adjustment sliders use a quick low-resolution preview while moving; the photo sharpens a moment
  after the slider stops. Exports are always full quality.
- Of the 25 template categories in the specification, 10 have a built-in template so far.
- Not built yet from the Phase 2 wish list: curved text, auto-fit text, paragraph spacing, vertical
  alignment, background removal, free-form drawing, pattern and
  image backgrounds, SVG import, gradient fills on shapes, RGB/HSL inputs (the native color picker
  covers them on most platforms).
- Stickers are a small original vector set (18). Textures are procedural (grain, light leak,
  vignette); there are no photo-based textures.
- A project that uses a custom font shows a fallback font on a device where that font was never
  uploaded (the panel says so).
### Carried over from Phase 1

- Local only: no accounts, no cloud sync, no project folders yet.
- No grouping, rulers or grid. Crop and pan inside a frame are sliders, not dragging on the canvas. Resizing an image from a side handle shows a stretched preview until release.
- Seamless projects cannot be converted to independent ones (or back) after creation. In seamless
  mode slides can be added or removed at the end only.
- Undo history is per editing session and is not persisted.
- Images are decoded at full resolution; preview proxies and Web Worker decoding are not in yet,
  so many very large photos in one project will be heavy on phones.
- SVG import is not enabled (it needs sanitising first).
- AI features, cloud sync: later phases, nothing stubbed in the UI.
