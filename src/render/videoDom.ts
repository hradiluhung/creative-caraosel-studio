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

/** Seek and wait until the frame at that time can be drawn. */
export async function seekVideo(video: HTMLVideoElement, time: number, timeoutMs = 8000): Promise<boolean> {
  if (video.readyState < 2 && !(await once(video, "loadeddata", timeoutMs))) return false;
  const target = Math.max(0, Math.min(time, lastFrameTime(video)));
  if (Math.abs(video.currentTime - target) > 0.0005) {
    const seeked = once(video, "seeked", timeoutMs);
    video.currentTime = target;
    if (!(await seeked)) return false;
    await framePresented(video);
  }
  return video.readyState >= 2 || (await once(video, "canplay", timeoutMs));
}
