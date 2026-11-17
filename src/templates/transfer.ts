/** Template files and IndexedDB: export a stored template, import a file as a new user template. */
import { createId } from "@/document/ids";
import { cloneProject } from "@/document/operations";
import { getAssetBlob, getAssetPoster, hasAsset, putAsset, putStoredTemplate } from "@/persistence/db";
import { packTemplate, unpackTemplate } from "./file";
import type { TemplateInfo } from "./index";

export function exportTemplateFile(template: TemplateInfo): Promise<Blob> {
  return packTemplate(template, async (id) => {
    const blob = await getAssetBlob(id);
    return blob ? { blob, poster: await getAssetPoster(id) } : undefined;
  });
}

/** Returns the id of the new template. Files already stored on this device are not written again. */
export async function importTemplateFile(file: Blob, now = new Date()): Promise<{ id: string; name: string }> {
  const content = await unpackTemplate(file);
  for (const asset of content.assets) {
    if (await hasAsset(asset.ref.id)) continue;
    await putAsset({ ...asset.ref, blob: asset.blob, ...(asset.poster ? { poster: asset.poster } : {}), createdAt: now.toISOString() });
  }
  const id = createId();
  await putStoredTemplate({
    id,
    name: content.name,
    category: content.category,
    description: content.description,
    // Fresh element and slide ids; asset ids stay, they are how the document finds its files.
    doc: cloneProject(content.doc, content.name, now),
    thumbnail: content.thumbnail,
    createdAt: now.toISOString(),
  });
  return { id, name: content.name };
}
