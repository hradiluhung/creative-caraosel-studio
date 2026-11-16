/** Editor commands shared by the desktop panels, the mobile sheets and keyboard shortcuts. */
import { createImage, createOverlay, createShape, createSticker, createText, createVideo, placementFor, type Placement, type TextPreset } from "@/document/factory";
import { getSurface, rotatedBounds } from "@/document/geometry";
import { createId } from "@/document/ids";
import { addAssetRef, addElements, setSlideAudio, setSlideDuration, splitVideo, updateElements } from "@/document/operations";
import { isVideoAsset, type AssetRef, type AudioTrack, type DesignElement, type OverlayKind, type ShapeKind, type TextElement } from "@/document/schema";
import { ensureFontsLoaded, resolveWeight } from "@/render/fonts";
import { measureTextHeight } from "@/render/scene";
import type { StickerDef } from "@/render/stickers";
import { importImageFile, sniffImageType } from "@/persistence/assets";
import { importAudioFile } from "@/persistence/audio";
import { importVideoFile } from "@/persistence/video";
import { createAudioTrack } from "@/document/timing";
import { sniffVideoType } from "@/persistence/videoSniff";
import { useEditorStore } from "@/store/editorStore";

const store = () => useEditorStore.getState();

/** Where new elements land: the slide the user is looking at. */
export function currentPlacement(): Placement | null {
  const s = store();
  const surface = s.project && getSurface(s.project, s.activeSurfaceId);
  if (!s.project || !surface) return null;
  const offset = s.project.mode === "seamless" ? s.focusSlideIndex * s.project.width : 0;
  return placementFor(surface, s.project.width, offset);
}

export function insertText(preset: TextPreset) {
  const p = currentPlacement();
  if (p) store().addElement(createText(preset, p));
}

/** Text in a given font (brand kit styles). Waits for the face so the box is measured correctly. */
export async function insertStyledText(preset: TextPreset, fontFamily: string, color?: string) {
  const p = currentPlacement();
  if (!p) return;
  const base = createText(preset, p);
  const el: TextElement = { ...base, fontFamily, fontWeight: resolveWeight(fontFamily, base.fontWeight), fill: color ?? base.fill };
  await ensureFontsLoaded([{ family: el.fontFamily, weight: el.fontWeight, italic: false }]);
  store().addElement({ ...el, height: measureTextHeight(el) });
}

export function insertSticker(def: StickerDef) {
  const p = currentPlacement();
  if (!p) return;
  const el = createSticker(def.id, def.name, def.width / def.height, p);
  store().addElement({ ...el, color: def.color ?? el.color });
}

export function insertOverlay(kind: OverlayKind) {
  const p = currentPlacement();
  if (p) store().addElement(createOverlay(kind, p));
}

/** Put a photo into an existing frame (placeholder or image), keeping its box, mask and look. */
export async function replaceImage(elementId: string, file: File): Promise<string | null> {
  try {
    const ref = await importImageFile(file);
    const s = store();
    s.commit((p) => updateElements(addAssetRef(p, ref), s.activeSurfaceId, [elementId], { assetId: ref.id } as Partial<DesignElement>));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "The image could not be imported.";
  }
}

export function insertShape(shape: ShapeKind) {
  const p = currentPlacement();
  if (p) store().addElement(createShape(shape, p));
}

const elementFor = (asset: AssetRef, p: Placement) => (isVideoAsset(asset) ? createVideo(asset, p) : createImage(asset, p));

export function insertAsset(asset: AssetRef) {
  const p = currentPlacement();
  if (p) store().addElement(elementFor(asset, p));
}

/** Import files with the given importer, register them in the project and place them on the canvas. */
async function importWith(files: Iterable<File>, importer: (file: File) => Promise<AssetRef>): Promise<string[]> {
  const errors: string[] = [];
  const added: DesignElement[] = [];
  const refs: AssetRef[] = [];
  for (const file of files) {
    try {
      refs.push(await importer(file));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `Could not import "${file.name}".`);
    }
  }
  const placement = currentPlacement();
  const s = store();
  if (refs.length === 0 || !placement) return errors;
  refs.forEach((ref, i) => {
    const el = elementFor(ref, placement);
    added.push({ ...el, x: el.x + i * 32, y: el.y + i * 32 });
  });
  // One undo step for the whole import.
  s.commit((p) => addElements(refs.reduce(addAssetRef, p), s.activeSurfaceId, added));
  s.select(added.map((e) => e.id));
  return errors;
}

/** Returns error messages (empty when everything was imported). */
export function importImages(files: Iterable<File>): Promise<string[]> {
  return importWith(files, importImageFile);
}

export function importVideos(files: Iterable<File>): Promise<string[]> {
  return importWith(files, importVideoFile);
}

/** Files dropped on the canvas: each one is routed by its real signature, never by its extension. */
export function importMedia(files: Iterable<File>): Promise<string[]> {
  return importWith(files, async (file) => {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (sniffImageType(head)) return importImageFile(file);
    if (sniffVideoType(head)) return importVideoFile(file);
    throw new Error(`"${file.name}" is not a supported image (JPG, PNG, WebP) or video (MP4, MOV, WebM).`);
  });
}

export type AlignEdge = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Align the selected elements to the slide they sit on (their visual, rotated bounds). */
export function alignSelected(edge: AlignEdge) {
  const s = store();
  const project = s.project;
  const surface = project && getSurface(project, s.activeSurfaceId);
  if (!project || !surface) return;
  s.commit((p) => {
    let next = p;
    for (const el of surface.elements) {
      if (!s.selection.includes(el.id) || el.locked) continue;
      const b = rotatedBounds(el);
      const slideIndex =
        project.mode === "seamless"
          ? Math.max(0, Math.min(project.slides.length - 1, Math.floor((b.x + b.width / 2) / project.width)))
          : 0;
      const left = slideIndex * project.width;
      const dx =
        edge === "left" ? left - b.x : edge === "center" ? left + project.width / 2 - (b.x + b.width / 2) : edge === "right" ? left + project.width - (b.x + b.width) : 0;
      const dy =
        edge === "top" ? -b.y : edge === "middle" ? surface.height / 2 - (b.y + b.height / 2) : edge === "bottom" ? surface.height - (b.y + b.height) : 0;
      next = updateElements(next, s.activeSurfaceId, [el.id], { x: Math.round(el.x + dx), y: Math.round(el.y + dy) });
    }
    return next;
  });
}

/** Cut a video clip in two at a slide time and select the second half. Returns false when the time is outside the clip. */
export function splitClipAt(id: string, slideTime: number): boolean {
  const s = store();
  const newId = createId();
  let done = false;
  s.commit((p) => {
    const result = splitVideo(p, s.activeSurfaceId, id, slideTime, newId);
    done = result.newId !== null;
    return result.project;
  });
  if (done) s.select([newId]);
  return done;
}

/** Fix the active slide's length in seconds, or pass undefined to follow its clips again. */
export function setActiveSlideDuration(duration: number | undefined) {
  const s = store();
  s.commit((p) => setSlideDuration(p, s.activeSurfaceId, duration), { coalesce: `slide-duration:${s.activeSurfaceId}` });
}

/** Import a music file and make it the background music of the active slide. Returns an error message or null. */
export async function importMusic(file: File): Promise<string | null> {
  try {
    const asset = await importAudioFile(file);
    const s = store();
    s.commit((p) => setSlideAudio(addAssetRef(p, asset), s.activeSurfaceId, createAudioTrack(asset)));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : `Could not import "${file.name}".`;
  }
}

/** Change the active slide's music, or remove it with null. Slider drags coalesce into one undo step. */
export function updateMusic(patch: Partial<AudioTrack> | null, coalesce?: string) {
  const s = store();
  s.commit(
    (p) => {
      const current = p.slides.find((slide) => slide.id === s.activeSurfaceId)?.audio;
      if (!current) return p;
      return setSlideAudio(p, s.activeSurfaceId, patch ? { ...current, ...patch } : undefined);
    },
    coalesce ? { coalesce: `music-${coalesce}:${s.activeSurfaceId}` } : undefined,
  );
}
