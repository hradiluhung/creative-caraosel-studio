/** Small helpers around detached <video> elements, shared by import and rendering. */

export function once(target: EventTarget, ok: string, timeoutMs: number, fail = "error"): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      window.clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      target.removeEventListener(fail, onFail);
      resolve(value);
    };
    const onOk = () => done(true);
    const onFail = () => done(false);
    const timer = window.setTimeout(onFail, timeoutMs);
    target.addEventListener(ok, onOk);
    target.addEventListener(fail, onFail);
  });
}

/** A detached, silent <video> that may load and seek without a user gesture (also on iOS). */
export function createSilentVideo(url: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  video.src = url;
  video.load();
  return video;
}

/** Stop downloading and decoding, and let the browser free the decoder. */
export function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

/** Last time that still shows a frame (seeking exactly to the end shows nothing in some browsers). */
export function lastFrameTime(video: HTMLVideoElement): number {
  return Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.04) : Infinity;
}

/** Wait until the frame the element currently points at has really been presented. */
function framePresented(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    // Feature detection: requestVideoFrameCallback is missing in older Safari and Firefox.
    if ("requestVideoFrameCallback" in video) {
      const timer = window.setTimeout(resolve, 250);
      video.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        resolve();
      });
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Size and duration are known. Fails fast when the browser reports an error for the file. */
export async function waitForMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  return video.readyState >= 1 || (!video.error && (await once(video, "loadedmetadata", timeoutMs)));
}

/**
 * Make the browser load picture data for a video that is not playing.
 * Desktop browsers do that on their own right after the metadata. iOS Safari does not: a video
 * that was never played stops at its metadata (no "loadeddata", readyState 1) until something
 * seeks it or plays it. Waiting for "loadeddata" alone would therefore wait forever there.
 */
async function loadFrameData(video: HTMLVideoElement, target: number, timeoutMs: number): Promise<boolean> {
  if (video.readyState >= 2) return true;
  if (await once(video, "loadeddata", 350)) return true;
  if (video.readyState >= 2) return true;
  if (video.error) return false;

  // 1. Ask for a frame by seeking. A seek to the current time can be ignored, so never ask for exactly 0.
  const seeked = once(video, "seeked", Math.min(timeoutMs, 4000));
  video.currentTime = Math.min(Math.max(target, 0.001), lastFrameTime(video));
  await seeked;
  if (video.readyState < 2 && !video.error) await once(video, "loadeddata", 1000);
  if (video.readyState >= 2) return true;
  if (video.error) return false;

  // 2. Last resort: a muted, inline video may start without a user gesture; one moment of playback
  // makes every browser decode. (Refused in iOS Low Power Mode, then this simply stays false.)
  const wasMuted = video.muted;
  video.muted = true;
  try {
    const playing = once(video, "timeupdate", Math.min(timeoutMs, 4000));
    await Promise.race([video.play(), sleep(4000)]);
    if (video.readyState < 2) await playing;
  } catch {
    /* playback was not allowed */
  }
  video.pause();
  video.muted = wasMuted;
  return video.readyState >= 2;
}

/** Seek and wait until the frame at that time can be drawn. */
export async function seekVideo(video: HTMLVideoElement, time: number, timeoutMs = 8000): Promise<boolean> {
  if (!(await waitForMetadata(video, timeoutMs))) return false;
  const target = Math.max(0, Math.min(time, lastFrameTime(video)));
  if (!(await loadFrameData(video, target, timeoutMs))) return false;
  if (Math.abs(video.currentTime - target) > 0.002) {
    const seeked = once(video, "seeked", timeoutMs);
    video.currentTime = target;
    if (!(await seeked)) return false;
    await framePresented(video);
  }
  return video.readyState >= 2 || (await once(video, "canplay", timeoutMs));
}
