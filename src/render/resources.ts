/**
 * Decoded image cache shared by the editor canvas, thumbnails and the exporter.
 * The blob loader is injected so rendering stays independent of persistence.
 */
export type BlobLoader = (assetId: string) => Promise<Blob | undefined>;

export interface RenderResources {
  /** Synchronous lookup. Returns undefined while an image is still decoding or is missing. */
  getImage(assetId: string): HTMLImageElement | undefined;
}

type Entry = { status: "loading" | "ready" | "error"; image?: HTMLImageElement; url?: string; promise: Promise<void> };

export class ImageStore implements RenderResources {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();

  constructor(private loader: BlobLoader) {}

  getImage(assetId: string) {
    const entry = this.entries.get(assetId);
    if (!entry) {
      void this.load(assetId);
      return undefined;
    }
    return entry.status === "ready" ? entry.image : undefined;
  }

  /** Object URL of a decoded asset, for plain <img> previews in panels. */
  getUrl(assetId: string) {
    const entry = this.entries.get(assetId);
    if (!entry) void this.load(assetId);
    return entry?.status === "ready" ? entry.url : undefined;
  }

  isMissing(assetId: string) {
    return this.entries.get(assetId)?.status === "error";
  }

  load(assetId: string): Promise<void> {
    const existing = this.entries.get(assetId);
    if (existing) return existing.promise;
    const entry: Entry = { status: "loading", promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        const blob = await this.loader(assetId);
        if (!blob) throw new Error("asset not found");
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.decoding = "async";
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("image decode failed"));
          image.src = url;
        });
        entry.image = image;
        entry.url = url;
        entry.status = "ready";
      } catch {
        entry.status = "error";
      }
      this.listeners.forEach((l) => l());
    })();
    this.entries.set(assetId, entry);
    return entry.promise;
  }

  async preload(assetIds: Iterable<string>) {
    await Promise.all([...assetIds].map((id) => this.load(id)));
  }

  /** Called whenever an image finishes loading, so canvases can redraw. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Release object URLs. Call when the editor unmounts. */
  dispose() {
    for (const e of this.entries.values()) if (e.url) URL.revokeObjectURL(e.url);
    this.entries.clear();
    this.listeners.clear();
  }
}
