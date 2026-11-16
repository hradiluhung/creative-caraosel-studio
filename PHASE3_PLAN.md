# Phase 3 plan and progress (video)

This file is the handoff note for Phase 3. Anyone (or any new Claude session) can continue from
here without the earlier chat. Read `ARCHITECTURE.md` first, then this file. Update the
"Progress" section after every finished checkpoint.

## State before Phase 3

- Phase 1 and Phase 2 are done, tested and committed-ready (see `ARCHITECTURE.md` sections 9 to 11 and 13).
- Checks that must stay green: `npm run typecheck`, `npm run lint`, `npm test` (74 tests after C1),
  `npm run test:e2e` (36 + 28 + 43 browser checks; headers of `tests/e2e*.mjs` explain the setup).
- Document schema was version 2. C1 bumped it to 3 with a `2 -> 3` migration in
  `src/document/migrations.ts` (never edit old migrations).

## Rules that must not be broken

- One document-to-pixels path: `buildSurfaceContent` in `src/render/scene.ts`. Video frames must
  be drawn through it too, so preview and export keep identical geometry.
- `src/document` stays free of React, Konva and browser APIs.
- Every change goes through `commit()` with a pure operation; no placeholder buttons; do not
  claim a feature works without a test or a real browser check.
- Photo slides export as images, video slides as MP4, packaged in one ordered ZIP. Never merge
  all slides into one video.
- Use feature detection (WebCodecs, codecs, `requestVideoFrameCallback`) and say clearly in the
  UI when a device cannot do something.

## Checkpoints (do them in order, sync and test after each)

### C1. Video as an element (no export yet)
- Schema v3: `video` element type (`assetId`, `trimStart`, `trimEnd`, `volume`, `muted`,
  `playbackRate`, `loop`, `posterTime`, plus the image-style `mask`, `cornerRadius`, flips,
  border) and `Slide.duration` (seconds, optional). `AssetRef` gains optional `duration`.
- Import: MP4, MOV, WebM where the browser can decode them (signature sniffing like
  `persistence/assets.ts`, size limit, read duration and dimensions from a `<video>` element,
  generate a poster frame blob stored with the asset).
- Rendering: `ImageStore` gets a video pool (one `HTMLVideoElement` per asset). The scene builder
  draws the current video frame as the pattern fill of the same mask outline images use. In
  non-interactive mode (thumbnails, image export) it draws the poster frame.
- Editor: play / pause for the active slide with a Konva animation that redraws while playing,
  properties panel section (trim, volume, mute, speed, loop, poster time).
- Tests: migration 2 -> 3, schema validation, sniffing; e2e: import a small MP4 fixture, see it
  in the document, poster visible in a PNG export.

### C2. Timeline
- Bottom timeline for the active slide when it contains video: playhead, play / pause, clip bar
  with draggable trim handles, split at playhead (creates two elements), zoom.
- Slide duration = longest clip unless set manually; text and image layers show as full-length
  bars (overlay tracks).

### C3. Video export
- Per video slide: render frames through the scene builder into a canvas at slide size, encode
  with WebCodecs `VideoEncoder` (H.264) and mux to MP4 with a small muxer library; audio from the
  clips through `AudioEncoder` (AAC) where supported. 30 fps default, 720p / 1080p, bitrate choice.
- Fallback when WebCodecs is missing: `MediaRecorder` on `canvas.captureStream()` (real time,
  format depends on the browser) with an honest note in the export dialog.
- Export dialog: mixed projects produce an ordered ZIP (`name-01.jpg`, `name-02.mp4`, ...),
  progress per slide, cancel, and a check that the MP4 duration and size are what was requested.
- e2e: mixed carousel of photo + video slides, ZIP order and file types, MP4 duration within
  tolerance.

### C4. Audio and polish
- Background music track per slide (asset type audio), volume, fade, waveform where practical.
- Video filters reuse the adjustment pipeline only if it stays real-time; otherwise limit video
  to masks, borders and blend modes and document it.
- Memory: release video elements for slides that are not visible; test with long clips on iPhone.

## Known risks

- iOS Safari: WebCodecs video encoding exists on recent versions but must be feature-detected;
  autoplay needs `muted` and `playsinline`; background tabs pause rendering.
- Seeking a `<video>` frame-accurately for export is slow; prefer decoding with `VideoDecoder`
  through a demuxer when available, and fall back to seek-and-capture.
- Large videos in IndexedDB can hit storage quota: check `navigator.storage.estimate()` on import.

## Progress

- [x] C1. Video as an element (done 2026-11-16)
- [ ] C2. Timeline
- [ ] C3. Video export
- [ ] C4. Audio and polish

### C1: what was built

- Schema v3 (`schema.ts`): `video` element, `Slide.duration`, `AssetRef.duration`; migration `2 -> 3`
  only bumps the version (everything new is optional or a new element type).
- `src/document/timing.ts` (pure): `clipDuration`, `videoTimeAt` (trim, speed, loop, hold last frame),
  `surfaceDuration` (manual duration or longest visible clip), `clampTrim`. **C2 and C3 must use these**
  so the timeline, the preview and the export agree on which source frame belongs to which moment.
- Import (`persistence/video.ts`, `videoSniff.ts`): signature sniffing (MP4, MOV, WebM; Matroska is
  refused), `canPlayType` check, 300 MB / 10 minute limits, `navigator.storage.estimate()` check,
  duration and size read from a `<video>`, poster still stored as `StoredAsset.poster`.
- Rendering (`render/videoPool.ts`, owned by `ImageStore.videos`): live `<video>` per playing element
  (one per asset unless two layers share a file), exact poster frames captured by seeking, and a frame
  canvas per element that the scene builder uses as the pattern fill of the mask outline
  (`videoNodes` in `scene.ts`). `BuildOptions.videoTime` undefined means poster frame; a number
  means "the frame at this slide time" (this is the hook C3 uses to draw export frames).
- Editor: `PlaybackBar` (play / pause / stop, clock), `canvasApi.togglePlayback` (started inside the
  tap so sound is allowed), a `Konva.Animation` in `CanvasStage` that calls `VideoPool.sync` and
  `refreshVideoFrames` every frame; properties section (trim, speed, poster time, "use current frame
  as poster", volume, mute, loop, mask, radius, border, flips); Videos section in the insert panel;
  dropping a video on the canvas works too.
- Export dialog says clearly that video layers are exported as a still (poster frame) until C3.

### C1: how it was verified

- `npm run typecheck`, `npm run lint`: clean. `npm test`: 74 tests (20 new: schema v3, migration
  2 -> 3, timing, sniffing, poster storage).
- `tests/e2e-phase3.mjs`: 43 checks in headless Chrome against the production build (import of MP4
  and WebM, rejected fake file, stored poster, poster frame in the editor and in the PNG export at
  the exact poster time, live playback, automatic stop, pause, trim, speed / mute / loop, mask, cover
  crop and flip in pixels, slide change, reload, undo). `tests/e2e.mjs` 36/36 and
  `tests/e2e-phase2.mjs` 28/28 still pass.
- Also tried by hand in an emulated phone viewport with a seamless project: import, play, auto stop.

### Not verified / decisions the next session should know

- **No real iPhone or Safari run yet.** MOV / HEVC, the autoplay rules for sound and memory with long
  clips are only handled in code (feature detection, muted retry with a notice), not tested on a device.
- The "sound was blocked" notice path has no automated test (headless Chrome never blocks it).
- All clips start at slide time 0. There is no per-clip start offset in the schema yet; C2's "split at
  playhead" needs one (add an optional field with a migration or default, do not reuse `trimStart`).
- `Slide.duration` exists in the schema and is honoured by `surfaceDuration`, but there is no UI to
  set it yet (C2). A seamless panorama has no duration field: it always uses its longest clip.
- When playback reaches the end it stops and shows the poster frames again (no looping preview).
- Video has no adjustments or filters (C4 decides). Videos are allowed in seamless projects.
- Video slides still export as JPG / PNG stills. Nothing about MP4 export exists yet (C3).

Notes for the next session: start with C2. The playhead already lives in the store (`playback`,
`playhead`) and in `CanvasStage` (`playTimeRef`, the exact value); a timeline only needs a way to set
it (seek while paused: set `playTimeRef`, then `setPlayback("paused", t)`).
