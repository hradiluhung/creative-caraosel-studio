import { createId } from "@/document/ids";
import type { AssetRef } from "@/document/schema";
import { putAsset } from "./db";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** iOS converts HEIC photos to JPEG automatically when the picker accepts these types. */
export const IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(",");
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 12000;

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetError";
  }
}

/** Check the real file signature instead of trusting the extension or the reported type. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function decodeSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new AssetError("The image is corrupted or cannot be decoded by this browser."));
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Validate, measure and store an imported image. The original file is kept untouched. */
export async function importImageFile(file: File): Promise<AssetRef> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AssetError(`"${file.name}" is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`);
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime = sniffImageType(head);
  if (!mime) throw new AssetError(`"${file.name}" is not a supported image (JPG, PNG or WebP).`);
  const { width, height } = await decodeSize(file);
  if (width < 1 || height < 1) throw new AssetError(`"${file.name}" has no pixels.`);
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    throw new AssetError(`"${file.name}" is ${width}x${height}px. The limit is ${MAX_IMAGE_SIDE}px per side.`);
  }
  const ref: AssetRef = { id: createId(), name: file.name || "image", mime, width, height, size: file.size };
  await putAsset({ ...ref, blob: file.slice(0, file.size, mime), createdAt: new Date().toISOString() });
  return ref;
}
