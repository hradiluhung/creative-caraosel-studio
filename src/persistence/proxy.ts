/**
 * Preview proxies for heavy videos.
 *
 * A phone can decode a 4K or high-bitrate camera clip, but decoding it AND drawing it into the
 * editor canvas 30 times a second is what makes the preview stutter. So, like video editors
 * do, a heavy source gets a small copy (720p, 30 fps, H.264) that the editor plays instead.
 * The original stays untouched and is what poster frames and every export are made from.
 *
 * Proxies are made in the background after import (and for videos imported earlier, when a
 * project opens). Until one is ready the editor simply plays the original.
 */
import type { AssetRef } from "@/document/schema";
import { isVideoAsset } from "@/document/schema";
import { getAssetBlob, getAssetProxy, putAssetProxy } from "./db";

/** Shorter side of a proxy, in pixels. */
export const PROXY_SHORT_SIDE = 720;
const PROXY_BITRATE = 2_500_000;
/** Sources above this average bitrate get a proxy even when they are small in pixels. */
const HEAVY_BITRATE = 8_000_000;

/** True when playing this source directly is likely to be too heavy for a smooth preview. */
export function needsProxy(asset: Pick<AssetRef, "mime" | "width" | "height" | "size" | "duration">): boolean {
  if (!isVideoAsset(asset) || !asset.duration) return false;
  const bitrate = (asset.size * 8) / asset.duration;
  return Math.min(asset.width, asset.height) > PROXY_SHORT_SIDE || bitrate > HEAVY_BITRATE;
}

export type ProxyState = { status: "working"; progress: number } | { status: "ready" } | { status: "failed" };

const states = new Map<string, ProxyState>();
const listeners = new Set<(assetId: string, state: ProxyState) => void>();
let queue: Promise<void> = Promise.resolve();

function setState(assetId: string, state: ProxyState) {
  states.set(assetId, state);
  listeners.forEach((l) => l(assetId, state));
}

export function proxyState(assetId: string): ProxyState | undefined {
  return states.get(assetId);
}

export function subscribeProxies(listener: (assetId: string, state: ProxyState) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Transcode one video to its proxy. Null when this browser cannot do it (the original is used then). */
export async function transcodeProxy(blob: Blob, onProgress?: (progress: number) => void): Promise<Blob | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return null;
  // Loaded on demand: the transcoder is a large library that only heavy videos need.
  const [{ ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output }, { registerAacEncoder }] = await Promise.all([
    import("mediabunny"),
    import("@mediabunny/aac-encoder"),
  ]);
  if (!aacRegistered) registerAacEncoder();
  aacRegistered = true;
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const landscape = track.displayWidth >= track.displayHeight;
    const scale = Math.min(1, PROXY_SHORT_SIDE / Math.min(track.displayWidth, track.displayHeight));
    const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        ...(landscape ? { height: even(track.displayHeight) } : { width: even(track.displayWidth) }),
        fit: "contain",
        frameRate: 30,
        codec: "avc",
        bitrate: PROXY_BITRATE,
        // A keyframe every second keeps scrubbing and trimming snappy.
        keyFrameInterval: 1,
      },
      audio: { codec: "aac", bitrate: 128_000 },
    });
    if (!conversion.isValid) return null;
    // A proxy that lost the picture or the sound would make the preview lie about the clip.
    const lost = conversion.discardedTracks.filter((d) => d.track.type === "video" || d.track.type === "audio");
    if (lost.length > 0) return null;
    conversion.onProgress = (p) => onProgress?.(p);
    await conversion.execute();
    const buffer = output.target.buffer;
    return buffer ? new Blob([buffer], { type: "video/mp4" }) : null;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
let aacRegistered = false;

/**
 * Make sure a heavy video has its proxy: nothing happens when it has one, does not need one,
 * or is already being worked on. Jobs run one after the other.
 */
export function ensureProxy(asset: AssetRef) {
  if (!needsProxy(asset) || states.has(asset.id)) return;
  setState(asset.id, { status: "working", progress: 0 });
  queue = queue.then(async () => {
    try {
      if (await getAssetProxy(asset.id)) return setState(asset.id, { status: "ready" });
      const blob = await getAssetBlob(asset.id);
      if (!blob) return setState(asset.id, { status: "failed" });
      let shown = 0;
      const proxy = await transcodeProxy(blob, (progress) => {
        if (progress - shown < 0.02) return;
        shown = progress;
        setState(asset.id, { status: "working", progress });
      });
      // Only worth keeping when it really is lighter than the original.
      if (!proxy || proxy.size >= blob.size) return setState(asset.id, { status: "failed" });
      await putAssetProxy(asset.id, proxy);
      setState(asset.id, { status: "ready" });
    } catch {
      setState(asset.id, { status: "failed" });
    }
  });
}
