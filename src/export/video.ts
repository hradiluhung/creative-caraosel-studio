/**
 * Video export. One MP4 per video slide.
 *
 * Every frame is drawn by the same scene builder as the editor and the image export
 * (src/render/scene.ts) with `videoTime` set, so a video export cannot disagree with the
 * preview about geometry. Which source frame belongs to which moment comes from
 * src/document/timing.ts.
 *
 *  - Main path (WebCodecs): frames are produced one by one, as fast as the device can seek
 *    and encode, and muxed into an MP4 (H.264, plus AAC or Opus sound).
 *  - Fallback (no WebCodecs): the slide is played in real time into a MediaRecorder. The file
 *    format is whatever that browser records, and there is no sound.
 */
import Konva from "konva";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { getSurface, type ExportFrame } from "@/document/geometry";
import type { AudioTrack, Project, VideoElement } from "@/document/schema";
import { frameClips, frameDuration, trackEnd, trackGainPoints } from "@/document/timing";
import type { ImageStore } from "@/render/resources";
import { buildSurfaceContent, refreshVideoFrames, type BuildOptions } from "@/render/scene";
import { createSilentVideo, releaseVideo, waitForMetadata } from "@/render/videoDom";
import { ClipFeed, openDecodedSource, type DecodedSource } from "./frameSource";
import {
  AUDIO_SAMPLE_RATE,
  audioEncoderConfig,
  detectVideoSupport,
  pickAvcCodec,
  VIDEO_FPS,
  videoBitrate,
  videoEncoderConfig,
  videoOutputSize,
  type AudioCodec,
  type VideoQuality,
  type VideoResolution,
  type VideoSize,
  type VideoSupport,
} from "./videoSupport";

export interface VideoExportOptions {
  resolution: VideoResolution;
  quality: VideoQuality;
  /** Sound codec, or null for a silent file. Ignored (silent) on the real-time fallback. */
  audio: AudioCodec | null;
  /** Throws when the export should stop. */
  check: () => void;
  onProgress?: (frame: number, totalFrames: number) => void;
}

export interface VideoExportResult {
  blob: Blob;
  ext: "mp4" | "webm";
  width: number;
  height: number;
  /** Seconds that were requested. */
  duration: number;
  hasAudio: boolean;
  /** True when the file was recorded in real time by the fallback. */
  realtime: boolean;
}

const KEYFRAME_EVERY_S = 2;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** The off-screen stage one slide's frames are drawn on, at output size. */
function createFrameStage(project: Project, frame: ExportFrame, images: ImageStore, size: VideoSize) {
  const surface = getSurface(project, frame.surfaceId);
  if (!surface) throw new Error(`Slide ${frame.slideIndex + 1}: surface not found`);
  const { resources, videos } = images.forExport();
  const stage = new Konva.Stage({ container: document.createElement("div"), width: size.width, height: size.height });
  const layer = new Konva.Layer({ listening: false });
  // One canvas pixel per output pixel, whatever the screen's pixel density is.
  layer.getCanvas().setPixelRatio(1);
  stage.add(layer);
  // Video has no transparency: anything not covered is white, like a JPG export.
  layer.add(new Konva.Rect({ width: size.width, height: size.height, fill: "#ffffff" }));
  const build: BuildOptions = { interactive: false, quality: size.scale, maxImageSide: 8192, showPlaceholders: false };
  const scaled = new Konva.Group({ scaleX: size.width / frame.width, scaleY: size.height / frame.height });
  const content = buildSurfaceContent(surface, resources, { ...build, videoTime: 0 });
  // Slicing a panorama is just an offset, exactly as in the image export.
  content.position({ x: -frame.x, y: -frame.y });
  scaled.add(content);
  layer.add(scaled);
  const clips = frameClips(project, frame);
  return {
    canvas: layer.getNativeCanvasElement(),
    clips,
    music: surface.audio,
    videos,
    /** Draw the slide as it looks at this slide time. The clips must already be on their frames. */
    draw(time: number) {
      refreshVideoFrames(content, surface.elements, resources, { ...build, videoTime: time });
      layer.draw();
    },
    destroy() {
      videos.dispose();
      stage.destroy();
    },
  };
}

/** Mix the sound of every audible clip over the slide's timeline. Null when there is nothing to hear. */
async function mixAudio(clips: VideoElement[], music: AudioTrack | undefined, duration: number, images: ImageStore, check: () => void): Promise<AudioBuffer | null> {
  const audible = clips.filter((el) => !el.muted && el.volume > 0 && el.start < duration);
  const track = music && music.volume > 0 && trackEnd(music, duration) > music.start ? music : undefined;
  if (audible.length === 0 && !track) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * AUDIO_SAMPLE_RATE)), AUDIO_SAMPLE_RATE);
  const decoded = new Map<string, AudioBuffer | null>();
  let any = false;
  if (track) {
    check();
    let buffer: AudioBuffer | null = null;
    try {
      const blob = await images.getBlob(track.assetId);
      if (blob) buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      buffer = null;
    }
    if (!buffer) throw new Error("The music of this slide could not be decoded by this browser.");
    const trimEnd = Math.min(track.trimEnd, buffer.duration);
    if (trimEnd > track.trimStart) {
      any = true;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      // The same curve the preview follows (timing.ts), as linear ramps between its corner points.
      const points = trackGainPoints(track, duration);
      gain.gain.setValueAtTime(points[0]?.gain ?? track.volume, 0);
      for (const point of points) gain.gain.linearRampToValueAtTime(point.gain, point.time);
      source.connect(gain).connect(ctx.destination);
      if (track.loop) {
        source.loop = true;
        source.loopStart = track.trimStart;
        source.loopEnd = trimEnd;
        source.start(track.start, track.trimStart);
      } else {
        source.start(track.start, track.trimStart, trimEnd - track.trimStart);
      }
      source.stop(trackEnd(track, duration));
    }
  }
  for (const el of audible) {
    check();
    if (!decoded.has(el.assetId)) {
      let buffer: AudioBuffer | null = null;
      try {
        const blob = await images.getBlob(el.assetId);
        if (blob) buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      } catch {
        buffer = null; // a video without a sound track, or sound this browser cannot decode
      }
      decoded.set(el.assetId, buffer);
    }
    const buffer = decoded.get(el.assetId);
    if (!buffer) continue;
    any = true;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = el.playbackRate;
    const gain = ctx.createGain();
    gain.gain.value = el.volume;
    source.connect(gain).connect(ctx.destination);
    const trimEnd = Math.min(el.trimEnd, buffer.duration);
    if (trimEnd <= el.trimStart) continue;
    if (el.loop) {
      source.loop = true;
      source.loopStart = el.trimStart;
      source.loopEnd = trimEnd;
      source.start(el.start, el.trimStart);
      source.stop(duration);
    } else {
      source.start(el.start, el.trimStart, trimEnd - el.trimStart);
    }
  }
  return any ? ctx.startRendering() : null;
}

async function encodeAudio(buffer: AudioBuffer, codec: AudioCodec, muxer: Muxer<ArrayBufferTarget>, check: () => void) {
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      failure = e;
    },
  });
  encoder.configure(audioEncoderConfig(codec));
  const channels = [buffer.getChannelData(0), buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)];
  const block = AUDIO_SAMPLE_RATE / 10;
  try {
    for (let offset = 0; offset < buffer.length; offset += block) {
      check();
      if (failure) throw failure;
      const frames = Math.min(block, buffer.length - offset);
      const data = new Float32Array(frames * 2);
      data.set(channels[0].subarray(offset, offset + frames), 0);
      data.set(channels[1].subarray(offset, offset + frames), frames);
      const audio = new AudioData({ format: "f32-planar", sampleRate: AUDIO_SAMPLE_RATE, numberOfFrames: frames, numberOfChannels: 2, timestamp: Math.round((offset / AUDIO_SAMPLE_RATE) * 1e6), data });
      encoder.encode(audio);
      audio.close();
      if (encoder.encodeQueueSize > 20) await sleep(0);
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

/** Read back what was really produced. */
async function readVideoInfo(blob: Blob): Promise<{ width: number; height: number; duration: number } | null> {
  const url = URL.createObjectURL(blob);
  const video = createSilentVideo(url);
  try {
    if (!(await waitForMetadata(video, 10_000))) return null;
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  } finally {
    releaseVideo(video);
    URL.revokeObjectURL(url);
  }
}

async function encodeMp4(project: Project, frame: ExportFrame, images: ImageStore, size: VideoSize, duration: number, opts: VideoExportOptions): Promise<VideoExportResult> {
  const bitrate = videoBitrate(size, opts.quality);
  const codec = await pickAvcCodec(size, bitrate);
  if (!codec) throw new Error("This browser cannot encode H.264 video at this size.");
  const totalFrames = Math.max(1, Math.round(duration * VIDEO_FPS));
  const slide = createFrameStage(project, frame, images, size);
  let failure: unknown = null;
  let encoder: VideoEncoder | null = null;
  const sources = new Map<string, DecodedSource | null>();
  const feeds = new Map<string, ClipFeed>();
  try {
    // Sound first: it decides whether the file gets an audio track at all.
    const mixed = opts.audio ? await mixAudio(slide.clips, slide.music, duration, images, opts.check) : null;
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: size.width, height: size.height, frameRate: VIDEO_FPS },
      ...(mixed && opts.audio ? { audio: { codec: opts.audio, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2 } } : {}),
      fastStart: "in-memory",
    });
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        failure = e;
      },
    });
    encoder.configure(videoEncoderConfig(codec, size, bitrate));
    // Where the file can be decoded directly, frames are read forward once (fast). Other clips
    // are seeked frame by frame through a <video> element (slow, but works for every playable file).
    for (const el of slide.clips) {
      opts.check();
      if (!sources.has(el.assetId)) {
        const blob = await images.getBlob(el.assetId);
        sources.set(el.assetId, blob ? await openDecodedSource(blob) : null);
      }
      const source = sources.get(el.assetId);
      if (!source) continue;
      const feed = new ClipFeed(el, source, totalFrames, VIDEO_FPS);
      feeds.set(el.id, feed);
      slide.videos.setFrameSource(el.id, { source: feed.canvas, width: feed.canvas.width, height: feed.canvas.height });
    }
    const seeked = slide.clips.filter((el) => !feeds.has(el.id));
    const frameMicros = 1e6 / VIDEO_FPS;
    for (let i = 0; i < totalFrames; i++) {
      opts.check();
      if (failure) throw failure;
      const time = i / VIDEO_FPS;
      for (const feed of feeds.values()) await feed.show(i);
      if (seeked.length > 0) await slide.videos.seekFrames(seeked, time);
      slide.draw(time);
      const picture = new VideoFrame(slide.canvas, { timestamp: Math.round(i * frameMicros), duration: Math.round(frameMicros) });
      encoder.encode(picture, { keyFrame: i % (VIDEO_FPS * KEYFRAME_EVERY_S) === 0 });
      picture.close();
      // Let the encoder catch up instead of queueing hundreds of raw frames in memory.
      while (encoder.encodeQueueSize > 4) await sleep(1);
      opts.onProgress?.(i + 1, totalFrames);
      if (i % 10 === 9) await sleep(0); // keep the dialog responsive (progress, Cancel)
    }
    await encoder.flush();
    if (failure) throw failure;
    if (mixed && opts.audio) await encodeAudio(mixed, opts.audio, muxer, opts.check);
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });

    // Check that the file really is what was asked for.
    const info = await readVideoInfo(blob);
    if (!info) throw new Error(`Slide ${frame.slideIndex + 1}: the MP4 that was produced cannot be opened.`);
    if (info.width !== size.width || info.height !== size.height) {
      throw new Error(`Slide ${frame.slideIndex + 1} was encoded at ${info.width}x${info.height}, expected ${size.width}x${size.height}.`);
    }
    const expected = totalFrames / VIDEO_FPS;
    if (Math.abs(info.duration - expected) > Math.max(0.15, 3 / VIDEO_FPS)) {
      throw new Error(`Slide ${frame.slideIndex + 1}: the MP4 is ${info.duration.toFixed(2)} s long, expected ${expected.toFixed(2)} s.`);
    }
    return { blob, ext: "mp4", width: size.width, height: size.height, duration: expected, hasAudio: !!mixed, realtime: false };
  } finally {
    if (encoder && encoder.state !== "closed") encoder.close();
    for (const feed of feeds.values()) await feed.close();
    for (const source of sources.values()) source?.dispose();
    slide.destroy();
  }
}

/** Fallback without WebCodecs: play the slide in real time and record the canvas. No sound. */
async function recordRealtime(project: Project, frame: ExportFrame, images: ImageStore, size: VideoSize, duration: number, recorderInfo: NonNullable<VideoSupport["recorder"]>, opts: VideoExportOptions): Promise<VideoExportResult> {
  const slide = createFrameStage(project, frame, images, size);
  const totalFrames = Math.max(1, Math.round(duration * VIDEO_FPS));
  try {
    await slide.videos.seekFrames(slide.clips, 0);
    slide.draw(0);
    const stream = slide.canvas.captureStream(VIDEO_FPS);
    const recorder = new MediaRecorder(stream, { mimeType: recorderInfo.mime, videoBitsPerSecond: videoBitrate(size, opts.quality) });
    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && parts.push(e.data);
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("The browser stopped recording."));
    });
    recorder.start(250);
    let time = 0;
    let last = performance.now();
    try {
      while (time < duration) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        opts.check();
        const now = performance.now();
        const step = Math.min(0.25, (now - last) / 1000);
        last = now;
        // Same clock rule as the editor preview: follow the video that leads.
        const state = slide.videos.sync(slide.clips, time + step, true);
        time = Math.max(0, time + step + (state.waiting ? -step : state.lead));
        slide.draw(Math.min(time, duration - 1e-3));
        opts.onProgress?.(Math.min(totalFrames, Math.round(time * VIDEO_FPS)), totalFrames);
      }
    } finally {
      slide.videos.sync(slide.clips, Math.min(time, duration), false);
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    }
    await stopped;
    opts.check();
    const blob = new Blob(parts, { type: recorderInfo.mime.split(";")[0] });
    if (blob.size === 0) throw new Error(`Slide ${frame.slideIndex + 1}: the browser recorded an empty file.`);
    return { blob, ext: recorderInfo.ext, width: size.width, height: size.height, duration, hasAudio: false, realtime: true };
  } finally {
    slide.destroy();
  }
}

/** Export one video slide. Picks WebCodecs when it works here, otherwise the real-time recorder. */
export async function exportVideoSlide(project: Project, frame: ExportFrame, images: ImageStore, opts: VideoExportOptions): Promise<VideoExportResult> {
  const clips = frameClips(project, frame);
  const duration = frameDuration(project, frame);
  if (clips.length === 0 || duration <= 0) throw new Error(`Slide ${frame.slideIndex + 1} has no video to export.`);
  if (clips.every((el) => el.start >= duration)) throw new Error(`Slide ${frame.slideIndex + 1}: every clip starts after the slide has ended.`);
  const size = videoOutputSize(frame.width, frame.height, opts.resolution);
  const support = await detectVideoSupport(size);
  if (support.mp4) return encodeMp4(project, frame, images, size, duration, { ...opts, audio: opts.audio && support.audio.includes(opts.audio) ? opts.audio : null });
  if (support.recorder) return recordRealtime(project, frame, images, size, duration, support.recorder, opts);
  throw new Error("This browser can neither encode nor record video. Export the video slides as still images instead.");
}
