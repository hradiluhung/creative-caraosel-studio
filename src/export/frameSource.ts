/**
 * Decoded video frames for export.
 *
 * Seeking a <video> element to every single frame works everywhere but is slow: each seek
 * decodes again from the previous keyframe. Where WebCodecs can decode the file, the frames
 * are read here with a demuxer and a VideoDecoder instead, strictly forward, so every packet
 * is decoded once. A clip whose file cannot be read this way simply has no feed and the
 * exporter falls back to seeking for that clip.
 */
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from "mediabunny";
import type { VideoElement } from "@/document/schema";
import { clipActive, videoTimeAt } from "@/document/timing";

/** Longest side of the picture a feed keeps (4K sources are scaled down while drawing). */
const MAX_SIDE = 2560;

export interface DecodedSource {
  sink: VideoSampleSink;
  width: number;
  height: number;
  /** Last timestamp that still has a frame. */
  lastTime: number;
  dispose(): void;
}

/** Open a video file for decoding. Null when this browser cannot demux or decode it with WebCodecs. */
export async function openDecodedSource(blob: Blob): Promise<DecodedSource | null> {
  if (typeof VideoDecoder === "undefined") return null;
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    const duration = await track.computeDuration();
    return {
      sink: new VideoSampleSink(track),
      width: track.displayWidth,
      height: track.displayHeight,
      lastTime: Math.max(0, duration - 0.001),
      dispose: () => input.dispose(),
    };
  } catch {
    input.dispose();
    return null;
  }
}

/** The frames one clip shows during an export, drawn one after the other into `canvas`. */
export class ClipFeed {
  readonly canvas: HTMLCanvasElement;
  /** Source time for every output frame, or null while the clip is not on screen. */
  private plan: Array<number | null>;
  private iterator: AsyncGenerator<VideoSample | null, void, unknown> | null = null;
  private drawn = false;

  constructor(
    el: VideoElement,
    private source: DecodedSource,
    totalFrames: number,
    fps: number,
  ) {
    const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.max(1, Math.round(source.width * scale));
    this.canvas.height = Math.max(1, Math.round(source.height * scale));
    this.plan = Array.from({ length: totalFrames }, (_, i) => {
      const time = i / fps;
      // A hair past the frame boundary, so rounding never lands on the frame before.
      return clipActive(el, time) ? Math.min(videoTimeAt(el, time) + 0.001, source.lastTime) : null;
    });
  }

  /** Put the picture for output frame `index` into the canvas. Returns false while the clip is off screen. */
  async show(index: number): Promise<boolean> {
    const time = this.plan[index];
    if (time === null || time === undefined) return false;
    const previous = index > 0 ? this.plan[index - 1] : null;
    // A new forward run starts when the clip comes on screen or loops back to its start.
    if (!this.iterator || previous === null || time < previous) {
      await this.iterator?.return();
      const run: number[] = [];
      for (let i = index; i < this.plan.length; i++) {
        const t = this.plan[i];
        if (t === null || (run.length > 0 && t < run[run.length - 1])) break;
        run.push(t);
      }
      this.iterator = this.source.sink.samplesAtTimestamps(run);
    }
    const step = await this.iterator.next();
    let sample = step.done ? null : step.value;
    // Before the track's first frame there is nothing yet: show that first frame.
    if (!sample && !this.drawn) sample = (await this.source.sink.samples().next()).value ?? null;
    if (sample) {
      const ctx = this.canvas.getContext("2d");
      if (!ctx) throw new Error("No 2D canvas for decoded video frames.");
      // draw() applies the rotation stored in the file (phone videos are often stored sideways).
      sample.draw(ctx, 0, 0, this.canvas.width, this.canvas.height);
      sample.close();
      this.drawn = true;
    }
    if (!this.drawn) throw new Error("The video decoder returned no picture.");
    return true;
  }

  async close() {
    await this.iterator?.return().catch(() => undefined);
    this.iterator = null;
    this.canvas.width = this.canvas.height = 0;
  }
}
