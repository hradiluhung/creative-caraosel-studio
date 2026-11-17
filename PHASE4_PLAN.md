# Phase 4 plan and progress (advanced features)

This file is the handoff note for Phase 4. Anyone (or any new Claude session) can continue from
here without the earlier chat. Read `ARCHITECTURE.md` first, then this file. Update the
"Progress" section after every finished checkpoint.

Scope, from `SPEC.md` section 23: advanced layouts, template creator, project version history,
cloud synchronization, AI assistant integration, advanced asset management, advanced image tools.
Details come from sections 6 (photo editor), 11 (templates), 14 (asset library), 16 (additional
creative features), 18 (database) and 21 (security).

## State before Phase 4

- Phases 1 to 3 are done and confirmed by the user on an iPhone and in Mac Chrome (see
  `ARCHITECTURE.md` and `PHASE3_PLAN.md`). Document schema is version 5; the IndexedDB database
  is version 2 (stores: `projectMeta`, `projectDocs`, `assets`, `fonts`, `templates`, `brandKits`).
- Checks that must stay green: `npm run typecheck`, `npm run lint`, `npm test` (102 tests before
  Phase 4), `npm run test:e2e` (36 + 28 + 127 browser checks before Phase 4, plus
  `tests/e2e-phase4.mjs`; headers of `tests/e2e*.mjs` explain the setup).
- Everything is local to the device: no accounts, no server, no cloud. `src/persistence/db.ts` is
  the only place that talks to storage, which is the seam a sync layer plugs into.

## Rules that must not be broken

- One document-to-pixels path: `buildSurfaceContent` in `src/render/scene.ts`. Layouts, crops and
  new image effects are document data drawn by it, never a second renderer.
- `src/document` stays free of React, Konva and browser APIs. New layout and history logic that
  can be pure lives there and is unit tested in Node.
- Every change to a project goes through `commit()` with a pure operation. Restoring a version is
  an ordinary, undoable change of the open document.
- Schema changes: a new version with a migration in `src/document/migrations.ts` (never edit old
  migrations). Database changes: a new `DB_VERSION` with an additive upgrade step (never drop data).
- Originals stay untouched; edits are non-destructive (crop, duotone and overlays are parameters).
- Templates stay editable design objects, never flattened images.
- **The app must keep working fully offline and without an account.** Cloud and AI are additions
  a user opts into; a local-only project stays possible (SPEC 18).
- No secret may ever be in client code. Anything that needs a private key (AI provider, service
  role) goes through a server route, and is not built until the key and the provider are decided.
- No placeholder buttons; do not claim a feature works without a test or a real browser check;
  say in the UI what a device or an account state cannot do.

## Checkpoints (do them in order where they depend on each other, sync and test after each)

### D1. Project version history (local) - can be done now
- Database v3: store `projectVersions` (id, projectId, createdAt, kind `auto` | `manual` |
  `before-restore`, optional name, the full document JSON, a small thumbnail), indexed by project.
- Automatic versions: when a project is opened with changes since the last version, and at most
  every 10 minutes while it is being edited. Manual: "Save version" with an optional name.
- Retention: named versions are kept until deleted; automatic ones are pruned to the newest 20.
- Editor panel "History": list with thumbnail, date, kind, slide count; preview; restore (saves
  the current state as a `before-restore` version first, and the restore itself is undoable);
  rename; delete.
- Assets referenced only by a version must survive: deleting unused assets and deleting a
  project have to take versions into account. Duplicating a project does not copy its history.
- Tests: retention and pruning, restore round trip, asset survival, migration of old versions
  through `parseProject` (a version saved under schema 5 must open after a later schema bump).

### D2. Advanced asset management (local library) - can be done now
- Dashboard tab "Assets": every stored photo, video and music file on this device with its
  metadata (name, type, size, dimensions, duration, upload date, which projects use it).
- Search, filter by type, sort; favorites; user folders ("collections") an asset can be put in.
- Delete with a clear usage warning (never silently break a project); bulk select.
- Editor: "From library" in the insert panel places any library asset into the current project
  without importing it again (assets are already shared between projects by id).
- Storage overview (used / quota via `navigator.storage.estimate()`), proxies and posters counted
  separately from originals.
- SVG import with sanitising (SPEC 6, 21): scripts, event handlers, external references and
  `foreignObject` are removed before the file is stored; rendered as an image asset.
- Tests: usage lookup, delete protection, collections, SVG sanitiser (unit), library flow (e2e).

### D3. Advanced layouts - can be done now
- Pure layout generators in `src/document/layouts.ts`: photo grid (rows x columns), masonry,
  asymmetric collage, magazine, overlapping stack, film contact sheet, scrapbook. Input: slide
  size, count, gap, margin, a seed; output: frames (x, y, width, height, rotation).
- Applying a layout creates photo placeholders (existing element type) or rearranges the selected
  photos into the frames, as one undoable operation. Works on a slide and across a seamless panorama.
- Insert panel section "Layouts" with live thumbnails drawn from the same generators.
- Tests: frames stay inside the slide, no overlap where the layout promises none, determinism by
  seed (unit); apply and fill placeholders, export pixels (e2e).

### D4. Template creator - can be done now
- What exists: built-in templates as functions, "save project as template", the template library
  with preview and use. Missing against SPEC 11: categories on user templates, search and the
  three filters (category, aspect ratio, slide count), duplicate, favorites and recents for user
  templates, and a way to author a template deliberately.
- Template mode in the editor: open a user template for editing; set name, category and
  description; turn photos into placeholders and back; mark text as placeholder text; video
  placeholders; save back to the template store.
- Template files: export a template as one file (document plus its assets) and import it, so
  templates can be shared and "administrators can add new templates later" without a code change.
- Tests: placeholder conversion keeps geometry and styling, export / import round trip including
  assets and custom font references, filters (unit); author, save, use, fill (e2e).

### D5. Advanced image tools - can be done now (except background removal)
- Free crop: pan and zoom the photo inside its frame (new optional crop parameters on image and
  video elements, default = today's center crop). This is the biggest gap in the photo editor.
- Duotone and color overlay in the adjustment pipeline (pure functions in `render/adjust.ts`).
- Rotate inside the frame in 90 degree steps; aspect ratio presets for a frame.
- Background removal: **needs a decision** (see "Decisions needed"): an on-device model is a
  40 to 180 MB download with licence questions; a hosted API needs a key and a server route.
- Tests: crop math (unit), preview equals export in pixels (e2e), duotone / overlay pixels.

### D6. Cloud synchronization (Supabase) - blocked, needs the user
- Entities from SPEC 18 (`users`, `projects`, `project_versions`, `assets`, `fonts`, `templates`,
  `brand_kits`) with row-level security; binary files in private storage buckets, never in rows.
- Sign in (email magic link or OAuth), per-project "sync to cloud" switch, upload queue that
  survives offline, conflict rule (last write wins per document with the loser kept as a version
  from D1), asset upload by content hash, download on a second device.
- Cannot be started honestly without: a Supabase project (URL and anon key), the choice of
  sign-in method, and a decision on storage limits and cost. It also cannot be tested from the
  environment the code is written in unless that project is reachable from it.

### D7. AI assistant integration - blocked, needs the user
- SPEC 16: prompt-based layout generation, font pairing, palettes, image placement, carousel
  text, template recommendations, smart cropping, background removal.
- Needs: a provider and model, an API key held by a server route (the app is currently a static
  PWA with no server side), a cost limit, and a decision on what leaves the device (photos?).
- The **Smart Seamless Assistant** part of SPEC 16 needs no AI and no server (rules over the
  document: elements crossing slide boundaries, near-misses in alignment, discontinuous
  backgrounds, suggested fixes). It can be done locally; it is listed here as D7a so it is not lost.

## Known risks

- Storage: version history multiplies document JSON (small) but keeps assets alive that the
  current document no longer uses (large, especially video). Show what history costs and let
  the user clear it. iOS can evict IndexedDB of a PWA that is not opened for weeks.
- IndexedDB upgrade to version 3 runs on every existing install: it must be additive and tested
  against a version 2 database with data.
- SVG is an attack surface (scripts, external loads). It is only ever drawn through `<img>` /
  canvas from a sanitised blob, never inlined into the page.
- Free crop changes how every photo is drawn: preview, thumbnails, export and the processed-bitmap
  cache key all have to agree, and old documents must look exactly as before.
- Layouts across a seamless panorama must not put a frame edge a few pixels off a slide boundary.
- Cloud sync is where data loss happens: nothing may be deleted locally because of a remote state
  until the conflict rule has been tested with two real devices.
- AI features send user content to a third party: this needs an explicit opt-in in the UI.

## Decisions needed from the user

1. Cloud (D6): create a Supabase project and share URL and anon key? Which sign-in method?
2. AI (D7): which provider, and is a small server side (Next.js route handlers on Vercel or
   similar) acceptable? Today the app can be hosted as static files.
3. Background removal (D5): on-device model (large download, works offline, check licence) or a
   hosted API (needs the server side from 2)?

## Progress

- [x] D1. Project version history (done 2026-11-17)
- [x] D2. Advanced asset management (done 2026-11-17, except the two items in D2b)
- [ ] D2b. SVG import with sanitising, bulk select in the Assets tab (not built yet)
- [x] D3. Advanced layouts (done 2026-11-17)
- [x] D4. Template creator (done 2026-11-17; text and video placeholders not built, see limits)
- [x] D5. Advanced image tools (done 2026-11-17; background removal skipped for the initial release)
- [ ] D6. Cloud synchronization (skipped for the initial release, user decision 2026-11-17)
- [ ] D7. AI assistant integration (skipped for the initial release, user decision 2026-11-17)

### D1: what was built

- `src/document/history.ts` (pure): retention (`versionsToPrune`: named versions are kept, the
  newest 20 unnamed ones stay), `shouldAutoVersion`, `restoredProject` (old content under the
  current project's id, name and creation date), labels.
- Database v3: store `projectVersions` with an index on `projectId`; `saveVersion` (prunes in the
  same transaction), `listVersions` (summaries without documents), `loadVersion` (through
  `parseProject`, so old versions are migrated), `renameVersion`, `deleteVersion`.
  `deleteProject` removes the project's history and frees assets that nothing else (project,
  template, brand kit, or another project's version) references.
- Editor: history button in the top bar opens `VersionHistoryDialog` (save with optional name,
  list with thumbnail, restore, rename, delete). `useVersionHistory` saves the automatic versions.
- Restore saves the current state as a `before-restore` version, then replaces the document
  through `commit()`: one undo step.

### D1: how it was verified

- 112 unit tests (10 new: retention, auto rule, restore identity, list / load, pruning with 25
  versions, rename and delete, a version saved under schema 2 opening under schema 5, asset
  survival and release, **upgrade of a real version 2 database with data**).
- `tests/e2e-phase4.mjs`: 15 checks (automatic version on open with thumbnail, named version,
  restore and its `before-restore` copy, undo of a restore, restore of a named version, rename,
  delete, reload). Other suites unchanged: 36/36, 28/28, 127/127.

### D1: limits

- Deleting a single version does not free assets that only that version used; they stay stored
  until the project is deleted. D2's asset library is where unused files become visible.
- The ten-minute automatic versions were verified by their rule (unit test), not by waiting.
- No side-by-side preview of a version beyond its thumbnail; no diff between versions.
- Not tried on a phone.

### D2: what was built

- `src/persistence/libraryModel.ts` (pure): asset kind, usage summary, collection name cleaning,
  `filterLibrary` (text, type, favorite, collection, unused, four sort orders), `summarizeStorage`.
- `db.ts`: `listLibrary` (every stored asset with the projects, templates, brand kits and saved
  versions that reference it), `updateAssetLibraryInfo` (favorite, collections), `deleteAsset`,
  `getAssetPreview`. Favorites and collections are optional fields on the stored asset, so there is
  no database upgrade and documents are untouched.
- Dashboard tab "Assets" (`AssetLibrary.tsx`): storage overview (files and bytes per type, unused
  files, browser estimate), search, type / collection / sort, Favorites and Unused toggles, "Add
  files" (photos and videos), details dialog with usage list, favorite, collections and delete.
  Deleting a file that is still used first shows where it is used and needs a second click.
- Editor: "From library" under Images (`LibraryPicker.tsx`) places a stored photo or video into
  the current project by reference (`insertLibraryAsset`, one undo step, no second copy).

### D2: how it was verified

- 8 new unit tests (model rules; storage with fake IndexedDB: usage across projects, versions and
  brand kits, favorites / collections, previews, delete).
- `tests/e2e-phase4.mjs`: 16 new checks (photo appears in Assets, usage, favorite and collections
  stored, add to library, each filter, search, picker in a second project referencing the same
  file, undo, delete warning naming both projects, delete).

### D2: limits

- **Not built:** SVG import and bulk select (tracked as D2b). SVG was left out on purpose: whether
  Safari keeps the export canvas usable after drawing an SVG needs a device test first.
- A deleted file cannot be brought back; documents that used it show the frame as missing.
- `listLibrary` reads every project document to compute usage. Fine for a personal library, not
  measured with hundreds of projects.
- Music files are listed and can be deleted, but "From library" offers photos and videos only.
- Videos added through "Add files" get no preview proxy until they are used in a project.
- Verified in desktop Chrome only.

### D3: what was built

- `src/document/layouts.ts` (pure, no randomness): `layoutBoxes(kind, count, area, {gap, seed})`
  for grid, masonry, asymmetric collage, magazine, overlapping, contact sheet and scrapbook
  (2 to 12 frames), `layoutArea` (slide minus a 6% margin, shifted for the slide in view of a
  seamless panorama), `assignBoxes` (existing photos to frames in reading order).
- Insert panel section "Layouts": frame count, gap, seven buttons whose thumbnails are drawn by
  the same generator. With fewer than two photos selected it adds empty photo frames (the existing
  placeholder element); with two or more unlocked photos or videos selected it rearranges exactly
  those. Either way one undo step (`applyLayout` in `actions.ts`).

### D3: how it was verified

- 9 new unit tests: every kind and count on a portrait and a wide area (count, inside the area,
  whole pixels), no overlap and full coverage for grid / masonry / collage / magazine, gap, the
  character of each kind, repeatability, clamping, reading-order assignment.
- `tests/e2e-phase4.mjs`: 9 new checks (seven layouts offered, grid adds four empty frames with
  the chosen gap, undo, rearranging three imported photos into magazine and scrapbook, undo).
- All suites after D3: 129 unit tests, e2e 36/36, 28/28, 127/127, 40/40.

### D3: limits

- The layout fills one slide (the one in view). There is no layout that spans several slides of a
  seamless panorama, and the seamless case was not covered by an e2e check.
- Scrapbook always uses the same seed, so the same count gives the same tilt every time.
- Margin is fixed at 6% of the shorter slide side; rows and columns are chosen automatically.
- Export of a filled layout was not tested separately (frames are ordinary image elements).
- Verified in desktop Chrome only.

### Smart guides fix (2026-11-17, requested before continuing)

- Root cause: snapping lived inline in the canvas drag handler and only knew the slide lines, only
  for a single selected element, and resizing had no snapping at all.
- Now in `src/document/snapping.ts` (pure, 14 unit tests): slide edges and centres plus the edges
  and centre of every other visible element; moving (single or multi-selection) and resizing (each
  dragged edge, free corners on both axes, proportional corners on the closer axis). Guides span
  the moving box and the target. Ctrl / Cmd held: no snapping.
- Also fixed on the way: dragging a multi-selection saved once per selected element (several undo
  steps); it is one undo step now.
- Verified by `tests/e2e-snap.mjs` (24 checks with real mouse drags, including the reported case:
  bottom edge of one object to the bottom edge of another). All other suites unchanged.
- Limits: a single element that is rotated does not snap while resizing (it does while moving, by
  its bounding box); no equal-spacing guides; text height is re-measured after a corner resize, so
  a text box's snapped bottom edge can end a pixel or two off; touch has no way to switch snapping
  off; desktop Chrome only, not tried on a phone.

### D5: what was built

- Document schema **version 6**: three optional fields on image elements, `crop` (`x`, `y` from
  -1 to 1, `zoom` 1 to 5, `turns` 0 to 3), `duotone` (dark colour, light colour, amount) and
  `overlay` (colour, opacity). Absent means exactly the old behaviour, so the migration from
  version 5 only changes the version number.
- `frameCrop` in `geometry.ts` (pure): cover the frame, zoom in, pan across what is hidden, measured
  on the photo after quarter turns. `reshapeFrame`: aspect presets around the frame's centre.
- `adjust.ts` (pure): `applyDuotone`, `applyColorOverlay`, and `applyLook` (adjustments, then
  duotone, then overlay), used by the main thread and the worker alike, so preview and export share
  one path.
- Properties panel for photos: Crop (zoom, move left / right, move up / down, rotate photo 90
  degrees, reset), frame shape presets (as photo, 1:1, 4:5, 3:4, 16:9, 9:16), Color effects
  (duotone with two colours and strength, colour overlay with colour and opacity), and "Turn into
  empty frame". Replacing a photo resets its crop.

### D5: how it was verified

- 13 new unit tests (crop math incl. bounds for many pan / zoom values, quarter turns, reshape,
  duotone and overlay pixels, order of the look, schema limits, version 5 document opening).
- `tests/e2e-phase4-tools.mjs`, 19 checks with exported PNG pixels: default centre crop, pan, zoom,
  reset, rotate inside the frame, undo, frame shapes, duotone values on the ramp, **preview pixel
  equals export pixel**, strength 0, overlay blend, nothing tinted outside the frame, reload.

### D5: limits

- Crop is set with sliders. There is no dragging of the photo inside its frame on the canvas.
- Crop, duotone and overlay are for photos only, not for video frames.
- Rotating inside the frame is in quarter turns only (no free straighten).
- No background removal (skipped for the initial release).
- Verified in desktop Chrome only.

### D4: what was built

- **Template mode**: `/editor?template=<id>` opens a user template in the normal editor. Autosave
  writes to the template (`saveTemplateDoc`: document, name, cover) and never to a project;
  version history is off; the top bar shows a "Template" badge and "Template settings"
  (category, description, frame count, "Turn all photos into empty frames").
- Pure rules in `src/templates/model.ts`: categories, input cleaning, `filterTemplates` (text incl.
  description, category, ratio, slide count, favorites, source; recents first), `countFrames`,
  `stripPhotos`.
- Library: "Edit template", "Duplicate" / "Make my own copy" (built-in templates become editable
  that way), "Export file", "Import template", description in the preview and in search.
- **Template files** (`src/templates/file.ts`, `transfer.ts`): one `.cctemplate` zip with the
  document, only the asset files it uses, video posters and the cover. Import validates
  everything: format and version, the document through `parseProject`, plain asset ids only, file
  type by bytes, size and count limits; files already on the device are not overwritten.
- `Dashboard` opens a tab from `?tab=`, so "Back to templates" lands on the right tab.

### D4: how it was verified

- 12 new unit tests (rules, round trip, eight kinds of bad file, storage, duplicate, export on one
  database and import on an empty one).
- `tests/e2e-phase4-tools.mjs`, 18 checks: save a project as template, edit it in template mode
  (rename, add text, details, empty the frames, undo), no project created, reload, category
  filter, search by description, export file, duplicate, import, refusal of a bogus file, copy of a
  built-in, project made from the edited template.
- All suites after D4 and D5: 168 unit tests; e2e 36/36, 28/28, 127/127, 40/40, 24/24, 38/38.

### D4: limits

- **Not built:** marking text as placeholder text, video placeholders, and a "new blank
  template" button (start from a project, a copy of a built-in, or an imported file instead).
- Custom fonts are referenced by name in a template file but the font file is not included; on a
  device without that font the text falls back.
- Deleting a template does not free its files; they show as unused in the Assets tab.
- Template files were only exported and imported in desktop Chrome, on one machine.

Notes for the next session: every Phase 4 checkpoint that is in scope for the initial release is
done except D2b (SVG import, bulk select in Assets). D6, D7 and background removal are skipped.
