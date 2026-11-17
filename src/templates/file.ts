/**
 * Template files: one .cctemplate file (a zip) holding the template document and the files it
 * uses, so a template can be moved to another device or shared without a code change.
 *
 *   template.json   { format, version, name, category, description, doc }
 *   assets/<id>     original file of every asset the document references
 *   posters/<id>    poster still of a video asset (optional)
 *   thumbnail       cover picture (optional)
 *
 * Reading never trusts the file: the document goes through parseProject, asset types are checked
 * against the bytes, and sizes and counts are limited.
 */
import type JSZip from "jszip";
import { DocumentError, parseProject } from "@/document/migrations";
import { isAudioAsset, isVideoAsset, type AssetRef, type Project } from "@/document/schema";
import { sniffImageType } from "@/persistence/assets";
import { sniffAudioType, sniffVideoType } from "@/persistence/videoSniff";
import { cleanTemplateCategory, cleanTemplateDescription, cleanTemplateName } from "./model";

export const TEMPLATE_FILE_FORMAT = "creative-carousel-template";
export const TEMPLATE_FILE_VERSION = 1;
export const TEMPLATE_FILE_EXTENSION = ".cctemplate";
export const MAX_TEMPLATE_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_TEMPLATE_ASSETS = 200;
const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

/** The zip library is only needed for template files, so it is fetched when one is exported or imported. */
const loadZip = async () => (await import("jszip")).default;

export class TemplateFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateFileError";
  }
}

export interface TemplateFileAsset {
  ref: AssetRef;
  blob: Blob;
  poster?: Blob;
}

export interface TemplateFileContent {
  name: string;
  category: string;
  description: string;
  doc: Project;
  assets: TemplateFileAsset[];
  thumbnail: Blob | null;
}

export type AssetReader = (id: string) => Promise<{ blob: Blob; poster?: Blob } | undefined>;

/** Only assets the document really uses are packed (and expected when reading). */
export function usedAssets(doc: Project): AssetRef[] {
  const used = new Set<string>();
  for (const c of [...doc.slides, doc.panorama]) for (const el of c.elements) if ("assetId" in el && el.assetId) used.add(el.assetId);
  for (const s of doc.slides) if (s.audio) used.add(s.audio.assetId);
  return doc.assets.filter((a) => used.has(a.id));
}

export async function packTemplate(
  template: { name: string; category: string; description?: string; doc: Project; thumbnail: Blob | null },
  readAsset: AssetReader,
): Promise<Blob> {
  const zip = new (await loadZip())();
  const assets = usedAssets(template.doc);
  for (const ref of assets) {
    const stored = await readAsset(ref.id);
    if (!stored) throw new TemplateFileError(`"${ref.name}" is missing on this device, so the template cannot be exported completely.`);
    zip.file(`assets/${ref.id}`, await stored.blob.arrayBuffer());
    if (stored.poster) zip.file(`posters/${ref.id}`, await stored.poster.arrayBuffer());
  }
  if (template.thumbnail) zip.file("thumbnail", await template.thumbnail.arrayBuffer());
  const manifest = {
    format: TEMPLATE_FILE_FORMAT,
    version: TEMPLATE_FILE_VERSION,
    name: cleanTemplateName(template.name),
    category: cleanTemplateCategory(template.category),
    description: cleanTemplateDescription(template.description ?? ""),
    thumbnailType: template.thumbnail?.type || null,
    doc: { ...template.doc, assets, brandKitId: null },
  };
  zip.file("template.json", JSON.stringify(manifest));
  // Photos and videos are already compressed: storing them as they are keeps export fast.
  return zip.generateAsync({ type: "blob", compression: "STORE", mimeType: "application/zip" });
}

function checkBytes(ref: AssetRef, head: Uint8Array) {
  const actual = isVideoAsset(ref) ? sniffVideoType(head) : isAudioAsset(ref) ? sniffAudioType(head) : sniffImageType(head);
  if (!actual) throw new TemplateFileError(`"${ref.name}" in this template file is not a supported photo, video or audio file.`);
  // MP4 and MOV share a container, and M4A audio sits in one too: compare the family, not the exact label.
  const family = (mime: string) => mime.split("/")[0];
  if (family(actual) !== family(ref.mime) && !(family(ref.mime) === "audio" && actual === "video/mp4")) {
    throw new TemplateFileError(`"${ref.name}" in this template file is not what it claims to be.`);
  }
}

export async function unpackTemplate(file: Blob): Promise<TemplateFileContent> {
  if (file.size > MAX_TEMPLATE_FILE_BYTES) throw new TemplateFileError("This template file is larger than 500 MB.");
  let zip: JSZip;
  try {
    zip = await (await loadZip()).loadAsync(await file.arrayBuffer());
  } catch {
    throw new TemplateFileError("This is not a template file.");
  }
  const entry = zip.file("template.json");
  if (!entry) throw new TemplateFileError("This is not a template file.");
  const text = await entry.async("string");
  if (text.length > MAX_MANIFEST_BYTES) throw new TemplateFileError("The template description inside this file is too large.");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new TemplateFileError("The template file is damaged.");
  }
  if (typeof manifest !== "object" || manifest === null || manifest.format !== TEMPLATE_FILE_FORMAT) throw new TemplateFileError("This is not a template file.");
  if (typeof manifest.version !== "number" || manifest.version > TEMPLATE_FILE_VERSION) {
    throw new TemplateFileError("This template file was made by a newer version of the app.");
  }
  let doc: Project;
  try {
    doc = parseProject(manifest.doc);
  } catch (e) {
    throw new TemplateFileError(e instanceof DocumentError ? `The template inside this file is not valid: ${e.message}` : "The template inside this file is not valid.");
  }
  const refs = usedAssets(doc);
  if (refs.length > MAX_TEMPLATE_ASSETS) throw new TemplateFileError("This template uses more files than can be imported.");
  const assets: TemplateFileAsset[] = [];
  for (const ref of refs) {
    // Asset ids become storage keys and zip paths: accept plain ids only.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(ref.id)) throw new TemplateFileError("The template file contains an invalid file reference.");
    const data = zip.file(`assets/${ref.id}`);
    if (!data) throw new TemplateFileError(`"${ref.name}" is missing from this template file.`);
    const bytes = await data.async("uint8array");
    checkBytes(ref, bytes.subarray(0, 64));
    const poster = zip.file(`posters/${ref.id}`);
    const posterBytes = poster && isVideoAsset(ref) ? await poster.async("uint8array") : null;
    assets.push({
      ref: { ...ref, size: bytes.byteLength },
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ref.mime }),
      ...(posterBytes && sniffImageType(posterBytes.subarray(0, 64)) ? { poster: new Blob([posterBytes as Uint8Array<ArrayBuffer>], { type: sniffImageType(posterBytes.subarray(0, 64))! }) } : {}),
    });
  }
  let thumbnail: Blob | null = null;
  const thumb = zip.file("thumbnail");
  if (thumb) {
    const bytes = await thumb.async("uint8array");
    const type = sniffImageType(bytes.subarray(0, 64));
    if (type && bytes.byteLength <= MAX_THUMBNAIL_BYTES) thumbnail = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    name: cleanTemplateName(str(manifest.name) || doc.name),
    category: cleanTemplateCategory(str(manifest.category)),
    description: cleanTemplateDescription(str(manifest.description)),
    doc: { ...doc, assets: assets.map((a) => a.ref), brandKitId: null },
    assets,
    thumbnail,
  };
}

/** File name for a downloaded template. */
export function templateFileName(name: string): string {
  const base =
    name
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60)
      .replace(/^-+|-+$/g, "") || "template";
  return `${base}${TEMPLATE_FILE_EXTENSION}`;
}

