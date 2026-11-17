# Test checklist for iPhone (and Safari / Firefox on the Mac)

Everything below has only run in desktop Chrome so far. Open the production build over HTTPS
(see README, "Try it on an iPhone"), add it to the Home Screen, and work through the list. Note
for each line: works, or what happened instead.

## Basics
- [ ] The app opens from the Home Screen and again with the phone in airplane mode.
- [ ] In airplane mode the Templates, Assets and Brand kits tabs open.
- [ ] Create a project, add text, a shape and a photo, close the app from the app switcher right
      after the last change, reopen: the last change is there.

## Smart guides (fix of 2026-11-17)
- [ ] Dragging an object snaps to slide edges and centre, with a pink guide.
- [ ] Dragging snaps to the edges and centre of another object.
- [ ] Resizing from a side handle snaps that edge to another object's edge and to the slide edge.
- [ ] Resizing a photo from a corner keeps its shape and still snaps.

## Phase 4
- [ ] Version history: save a version, change something, restore, undo the restore.
- [ ] Assets tab: files appear, the star on a card adds and removes a favorite, filters work.
- [ ] Assets tab: Select, Select all shown, Favorite, Unfavorite, Add to collection, Delete.
- [ ] Editor: "From library" places a photo from another project.
- [ ] Layouts: each of the seven adds frames; with photos selected it rearranges them.
- [ ] Photo crop sliders (zoom, move), "Rotate photo 90°", frame shape presets.
- [ ] Duotone and color overlay: the preview matches the exported image.
- [ ] Sliders are smooth enough to use while dragging.
- [ ] Templates: "Edit template" opens with the Template badge; changes stay after reopening.
- [ ] Templates: "Export file" produces a `.cctemplate` file in Files; "Import template" reads it.

## Phase 5
- [ ] Text in the dashboard and panels is readable in light and dark mode.
- [ ] With VoiceOver on, buttons in the dashboard and the top bar are announced with sensible names.
- [ ] Dialogs can be closed and do not trap you (the keyboard does not cover the buttons).
- [ ] Fill the phone's storage or use a nearly full device if one is at hand: a failed save shows
      "Not saved" with a reason and "Retry".

## Safari and Firefox on the Mac
- [ ] Dashboard and editor load without errors in the console.
- [ ] Image export (JPG, PNG, ZIP) works.
- [ ] Video import, playback and MP4 export (Firefox may fall back to real-time recording or
      refuse some formats; note what the app says).
- [ ] Custom font upload and the color eyedropper (the eyedropper is missing where the browser
      has none, which is expected).
