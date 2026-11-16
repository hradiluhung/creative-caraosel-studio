# Phase 3 plan and progress (video)

This file is the handoff note for Phase 3. Anyone (or any new Claude session) can continue from
here without the earlier chat. Read `ARCHITECTURE.md` first, then this file. Update the
"Progress" section after every finished checkpoint.

## State before Phase 3

- Phase 1 and Phase 2 are done, tested and committed-ready (see `ARCHITECTURE.md` sections 9 to 11 and 13).
- Checks that must stay green: `npm run typecheck`, `npm run lint`, `npm test` (100 tests),
  `npm run test:e2e` (36 + 28 + 121 browser checks; headers of `tests/e2e*.mjs` explain the setup).
- Document schema was version 2. C1 bumped it to 3, C2 to 4 and C4 to 5, each with a migration in
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
- [x] C2. Timeline (done 2026-11-16)
- [x] C3. Video export (done 2026-11-16)
- [x] C4. Audio and polish (done 2026-11-16, see "C4: not done / not verified")

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
- `tests/e2e-phase3.mjs`: 48 checks in headless Chrome against the production build (import of MP4
  and WebM, rejected fake file, stored poster, poster frame in the editor and in the PNG export at
  the exact poster time, live playback, automatic stop, pause, trim, speed / mute / loop, mask, cover
  crop and flip in pixels, slide change, reload, undo). `tests/e2e.mjs` 36/36 and
  `tests/e2e-phase2.mjs` 28/28 still pass.
- Also tried by hand in an emulated phone viewport with a seamless project: import, play, auto stop.

### Not verified / decisions the next session should know

- **First iPhone run (2026-11-16) found a real bug, now fixed:** importing an MP4 waited 20 s and
  then failed with "cannot be decoded by this browser". Cause: iOS Safari never fires `loadeddata`
  for a video that is not playing (it stops at the metadata until something seeks or plays it), and
  the import waited for exactly that event. `seekVideo` in `render/videoDom.ts` now asks for a frame
  by seeking (and, as a last resort, a moment of muted playback), the poster still is best effort, and
  the error messages say which step failed. `tests/e2e-phase3.mjs` simulates that browser behaviour in
  Chrome (it failed with the same message and the same 20 s before the fix). **The fix itself has not
  been confirmed on the iPhone yet.** MOV / HEVC, the autoplay rules for sound and memory with long
  clips are still only handled in code, not tested on a device.
- The "sound was blocked" notice path has no automated test (headless Chrome never blocks it).
- When playback reaches the end it stops and shows the poster frames again (no looping preview).
- Video has no adjustments or filters (C4 decides). Videos are allowed in seamless projects.
- Video slides still export as JPG / PNG stills. Nothing about MP4 export exists yet (C3).

### Playback lag on the iPhone (reported 2026-11-16, after C1)

Import worked on the iPhone after the `loadeddata` fix, but preview playback was laggy. This was a
weakness of the C1 preview, not something later checkpoints would have fixed. Changes:

- **The clock follows the video.** Before, the wall clock was the master and a video that started
  late or stuttered was forced to seek to catch up, again and again. Now `VideoPool.sync` returns
  how far the leading clip is from the clock and `CanvasStage` moves the clock; a playing video is
  only seeked when it is far off (loop wrap, trim change). The clock holds while a clip is starting
  or buffering (at most 3 s).
- **Repaint at the video's frame rate** (`requestVideoFrameCallback` where available) instead of 60
  times a second.
- **Fewer pixels while playing:** the content layer is drawn at a pixel ratio of at most 1.5 during
  playback (full ratio again on pause / stop) and video frames at their on-screen size.
- Live `<video>` elements are attached to the page (2 px, nearly transparent) because Safari
  decodes at full rate only for videos in the document.
- `tests/perf-playback.mjs` (phone viewport at 3x, CPU throttled 4x, 1080p clip): painted frames per
  second went from 7.8 to about 13, forced seeks during playback from 2 or 3 to 0. These numbers come
  from software-rendered headless Chrome and only show the direction.
- **Not confirmed on the iPhone yet.** If it still lags there, the next things to try are caching the
  non-video layers as bitmaps during playback and lowering `PLAYBACK_PIXEL_RATIO` in `CanvasStage`.

### C2: what was built

- Schema v4: every video element has `start` (slide seconds). Migration `3 -> 4` sets it to 0.
- `timing.ts`: a clip is on screen only while it plays (`clipActive`): from `start` until one pass
  is over, or until the end of the slide when it loops. New pure edit helpers `trimClipStart`,
  `trimClipEnd`, `moveClip`, `splitClip`; operations `splitVideo` and `setSlideDuration`.
- `Timeline.tsx` (replaces the floating play button; `PlaybackBar` is now its transport): ruler with
  a draggable playhead, one bar per clip with trim handles, drag a bar to move it in time, split at
  the playhead, zoom, the other layers as full-length bars, fixed slide length (independent slides
  only). Folded by default on phones. Trim and move drags are one undo step each.
- `canvasApi.seek(t)`: pauses at `t` and shows that frame. The scene builder hides clips that are
  not active at the requested `videoTime` (poster mode still shows every clip).
- Properties panel: "Starts at".

### C2: how it was verified

- 83 unit tests (9 new: migration 3 -> 4, start offsets, trim / move / split helpers, `splitVideo`,
  `setSlideDuration`). `tests/e2e-phase3.mjs` has 25 new timeline checks (scrub by press and drag with
  pixel checks, split, playback through the cut, trim both edges, undo, move, typed start, zoom, slide
  length, reload). All suites: 36/36, 28/28, 73/73.
- Looked at on a desktop and an emulated phone viewport. **Not tried on a real phone.**
- Test note: Puppeteer's clipped screenshots resize the window for a moment unless
  `captureBeyondViewport: false` is passed. That flipped the app into its phone layout, remounted
  the canvas and released the videos; the helper in the e2e file now passes the flag.

### C2: known gaps

- At a cut the second clip is a second `<video>` that has to start: the preview can hold for a
  moment there. Export (C3) must not have this: it decodes frames by time, not by playing.
- A seamless panorama has no fixed length (it always follows its last clip).
- No snapping between clips, no ripple delete, no multi-select on the timeline.

### C3: what was built

(The muxer and the sound encoder described here were replaced later: see "Device test round 1".)

- `src/export/video.ts`: one video file per video slide. Each frame is drawn by the scene builder
  (`buildSurfaceContent` once, then `refreshVideoFrames` with `videoTime` per frame) on an off-screen
  stage at output size, encoded with WebCodecs `VideoEncoder` (H.264, High profile with Main and
  Baseline as fallbacks) and muxed to MP4 with `mp4-muxer`. 30 fps; 720p or 1080p (short side, never
  upscaled, even sides); three quality levels (bits per pixel).
- **Frames are decoded, not seeked** (`src/export/frameSource.ts`, library `mediabunny`): the file is
  demuxed and decoded forward once with `VideoDecoder`. Seeking a `<video>` to every frame took 55 s
  for a 6 s 1080p clip in the test environment; decoding takes under 4 s. A clip whose file cannot be
  decoded this way falls back to seeking (`VideoPool.seekFrames`), per clip.
- Sound: the audible clips are mixed over the slide's timeline with `OfflineAudioContext` (start,
  trim, loop, volume, speed) and encoded with `AudioEncoder`: AAC where the browser can, Opus as a
  second choice, or no sound. The dialog only offers what was detected.
- Fallback without WebCodecs: the slide is played in real time into `MediaRecorder` on
  `canvas.captureStream()`; format is whatever the browser records, no sound. The dialog says so.
- `exportSlides` now returns mixed files; `packageZip` gives `name-01.jpg`, `name-02.mp4`, ... in
  slide order. Slides are never merged into one video. Every MP4 is opened again after encoding and
  its size and duration are compared with what was asked.
- Export dialog: "Video file / Still image" for video slides, size, quality, sound, an honest note
  about what this device will produce, progress per frame, cancel.
- `src/export/videoSupport.ts` (feature detection, sizes, bitrates) is separate from `video.ts` so
  the two libraries (about 450 kB) are only loaded when a video is exported. The timeline fetches that
  chunk as soon as a slide has video, so the service worker has it for offline use.

### C3: how it was verified

- 88 unit tests (5 new: which frames are video and how long, panorama slices, output size, bitrate,
  file names). `tests/e2e-phase3.mjs` has 17 new checks: mixed ZIP order and file types by signature,
  H.264 and sound track present, size, duration, **frame content at 0 / 0.9 / 1.1 / 1.9 s** (red, red,
  blue, blue: the export is frame exact around the color change), trim and 720p and "no sound",
  a split clip exported seamlessly across the cut, and the real-time fallback with WebCodecs removed.
  All suites: 36/36, 28/28, 90/90.
- Checked by hand with ffprobe / ffmpeg: 60 frames for 2 s, frame 29 red and frame 30 blue, the
  sound track is audible (-21 dB mean).

### C3: not verified / limits

- **AAC could not be tested**: the test browser (Chrome on Linux) cannot encode AAC, so sound was
  verified with Opus only. The AAC path differs by one codec string. Chrome on macOS / Windows /
  Android encodes AAC; Safari only in recent versions. Where neither works the MP4 is silent and the
  dialog says so.
- **Not run on an iPhone or in Safari.** WebCodecs encoding, `mediabunny` decoding and the share
  sheet for MP4 are expected to work there but are untested.
- A clip that is sped up or slowed down changes pitch in the export (the preview keeps the pitch).
- The whole MP4 is built in memory, and sound is decoded from the whole source file: fine for
  carousel-length slides, heavy for many minutes of 1080p on a phone.
- The real-time fallback needs the tab to stay in front and its length is only approximately checked.
- HEVC or other sources the browser can play but `VideoDecoder` cannot decode use the slow seek path.

### C4: what was built

- **Background music per slide.** Schema v5: optional `Slide.audio` (`assetId`, `start`, `trimStart`,
  `trimEnd`, `volume`, `fadeIn`, `fadeOut`, `loop`); audio assets have `width` / `height` 0. Migration
  `4 -> 5` only bumps the version. Music exists on independent slides that contain video (a slide
  without video is a still image and has no duration); a seamless panorama has no music track.
- Import (`persistence/audio.ts`): MP3, M4A and WAV by signature (an `.m4a` is no longer mistaken for
  a video), length from an `<audio>` element, 60 MB limit, and a 240-bar waveform stored with the
  asset (skipped for files over 12 minutes, where decoding the whole song would need too much memory).
- Timeline: a music bar with its waveform (drag to move, handles to trim), volume, fade in / out,
  loop, replace, remove. All undoable.
- One gain curve for preview and export (`trackGainAt` / `trackGainPoints` in `timing.ts`). Preview:
  `render/musicPlayer.ts`, an `<audio>` element kept in step with the playback clock. Export: the
  track is mixed with the clips' sound in `mixAudio`, the fades as linear ramps.
- **Video filters: decided against, and documented.** The adjustment pipeline is per-pixel
  JavaScript: on a desktop core one 1080p frame takes about 18 ms for color adjustments and about
  240 ms with blur (measured), several times that on a phone, against a 33 ms budget at 30 fps. Video
  is therefore limited to masks, corner radius, borders, shadows, flips, opacity and blend modes. The
  properties panel says so.
- Polish: a hidden tab pauses playback (media keeps running while painting stops); the preview no
  longer preserves pitch for sped-up or slowed-down clips, so it sounds like the export; live videos
  are released on stop and when leaving the slide (already since C1 / C2).

### C4: how it was verified

- 95 unit tests (7 new: schema v5, migration, track window, gain curve and its corner points, audio
  signatures, waveform bars). `tests/e2e-phase3.mjs` has 15 new checks: rejected fake file, WAV and MP3
  import, stored waveform, music bar and drawn waveform, fade in stored, playback to the end with
  music, **the sound of the exported MP4 measured** (clips muted: music present; with a 1 s fade in the
  first 0.2 s is much quieter than the middle; with the music moved to start at 1 s the first second
  is silent), remove and undo. All suites: 36/36, 28/28, 105/105.

### C4: not done / not verified

- **"Test with long clips on iPhone" was not done.** Nothing in Phase 3 after the import fix has been
  run on a real phone by me: playback smoothness, the timeline with touch, MP4 export and music are
  verified in desktop Chrome (and an emulated phone viewport) only.
- **The preview's sound cannot be checked in a headless browser**, so music playback in the editor is
  only verified indirectly (the slide plays to its end without errors). The exported sound is measured.
- iOS ignores the volume of media elements: in the preview there, clip volume, music volume and fades
  are not audible (everything plays at full volume). The export applies them. A Web Audio gain node
  would fix the preview; not built.
- No waveform for video clips, no separate music for a seamless panorama, no music on slides without
  video, one music track per slide.

## Device test round 1 (2026-11-16, iPhone and Mac Chrome) and what was changed

Results reported after C4, and the fixes. **None of these fixes has been confirmed on the devices yet.**

1. *Playback smooth now for a short clip.* Confirmed on the iPhone (the lag fix after C1 works).
2. *Exported MP4 had no sound with AAC, on the iPhone and in Mac Chrome.* The cause was not found: it
   could not be reproduced (Chrome on Linux has no AAC encoder at all), so this is a change of
   approach, not a located bug. Sound is now encoded by mediabunny's WebAssembly AAC encoder
   (`@mediabunny/aac-encoder`, FFmpeg's encoder), which behaves the same in every browser and could be
   tested here; `mp4-muxer` and the hand-written `AudioEncoder` code are gone (mediabunny writes the
   file). After every export with sound, `verifySound` decodes the finished file and compares its
   loudness with the mix: a silent sound track is now an error, never a "done". The Opus option is
   gone. Verified here: AAC-LC track present (ffprobe), audible, fades measured.
   If the file is still silent on the devices, the next suspect is the mix itself
   (`OfflineAudioContext.decodeAudioData` of the source on that device), and the new error message
   is the first thing to look at: when the mix has sound and the file does not, the export now fails
   with a message. When the mix itself is silent, `verifySound` cannot tell that apart from a quiet
   clip, and the file is still exported.
3. *A 56 s clip played back laggy on the iPhone.* Assumed cause (not measured on the device): the
   source is heavy (camera clips are 1080p / 4K, often 60 fps, HEVC), and decoding plus drawing it into
   the canvas is too much. New: **preview proxies** (`persistence/proxy.ts`). A video above 720p or
   8 Mbit/s gets a 720p / 30 fps / H.264 copy made in the background with mediabunny (after import,
   and for older assets when a project opens); the editor plays the copy, poster frames and exports
   use the original. The timeline shows the progress. Measured here with an 8 s 4K 60 fps clip on a
   throttled phone profile: 6.9 painted frames per second before, 16.8 with the proxy.
4. *Limit: 60 s per video slide (Instagram's limit).* `MAX_VIDEO_SLIDE_SECONDS = 60` in `timing.ts`:
   a new clip takes at most the first 60 s of its file, trim and move cannot push a clip past 60 s,
   the slide length is capped there, and whatever still runs over (a slowed-down clip) is cut off, in
   the preview and in the export. Longer source files can still be imported (10 minutes, 300 MB).
5. *Trimming from the end left no room to drag the handle back out* (the trimmed clip filled the
   timeline again). The ruler now covers everything a clip could be stretched back to (`clipReach`),
   drawn as a dashed outline behind the bar, so the scale no longer changes when a clip is trimmed.

Checks after these changes: 100 unit tests; e2e 36/36, 28/28, 115/115 (new: clip sound audible in the
exported AAC, trim handle has room and stretches back, proxy stored and played, export from the
original).

## Device test round 2 (2026-11-16, iPhone)

Reported: sound in exports, the 60 s limit and trimming now work. Still broken: the 56 s clip played
choppy and far too slowly, with sound glitching or repeating, also after its lighter copy was ready.

- **Root cause (reproduced in Chrome by simulating one browser behaviour, not observed on the device
  itself):** `VideoPool.sync` treated `video.readyState < 3` as "still buffering" and held the playback
  clock. A long video on iOS reports readyState 2 while it plays normally (it only buffers a little
  ahead; a short clip is buffered completely, which is why short clips were fine). So the clock stood
  still while the video ran on; at the end of the file the video was rewound to the stale clock and
  played again. With Chrome made to report readyState 2 during playback, a 6 s clip took over 60 s to
  "play" (`LOW_READYSTATE=1 node tests/perf-playback.mjs`), with all three symptoms. It was a bug in the
  lag fix made after C1, not a decoding-speed problem, so the preview proxy could not help with it.
- **Fix:** no readyState check while playing. The clock always follows the leading video (a stalled
  video simply stops advancing, and the clock with it), and a clip that is still starting no longer
  holds the clock while another one leads. Same simulation after the fix: 6.6 s. The e2e test now
  simulates this too and checks normal speed and zero rewinds.
- **Unverified:** that iOS really reports readyState 2 here. If the clip still stutters, that
  assumption was wrong and the next step is to log `readyState`, `currentTime` and the clock on the
  device instead of guessing again.
- New: a video frame can be switched to any other video already imported into the project
  ("Video file" in the properties of a video layer), without importing it again.

## Phase 3 status

All four checkpoints are implemented and pass the automated checks listed above, in desktop Chrome.
What still needs a person with the device, in order of risk:

1. iPhone and Mac Chrome: does an exported MP4 have sound now? (item 2 above)
2. iPhone: the 56 s clip. Wait until "Preparing a lighter copy" is gone, then play. Smooth?
   (item 3; also check how long the preparing takes and that the picture looks right, in particular
   for HDR / Dolby Vision camera clips)
3. iPhone: trim from the end, then stretch back out (item 5).
4. iPhone: export a mixed carousel, open the MP4 in Photos and upload it to Instagram.
5. iPhone: export time and memory for a full 60 s slide.
