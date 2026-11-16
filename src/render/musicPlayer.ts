/**
 * Preview playback of a slide's background music: one <audio> element that is kept in step
 * with the editor's playback clock, the same way VideoPool keeps the clips in step.
 * The export does not use this: it mixes the sound offline (src/export/video.ts).
 */
import type { AudioTrack } from "@/document/schema";
import { audioTimeAt, trackActive, trackGainAt } from "@/document/timing";

/** How far the music may run away from the clock before it is pulled back, in seconds. */
const DRIFT_TOLERANCE = 0.25;

export class MusicPlayer {
  private audio: HTMLAudioElement | null = null;
  private assetId: string | null = null;

  constructor(private url: (assetId: string) => string | undefined) {}

  /**
   * Called with the slide time on every playback tick (and once inside the tap that starts
   * playback, so the browser allows the sound). `track` undefined stops the music.
   */
  sync(track: AudioTrack | undefined, time: number, playing: boolean, slideDuration: number) {
    if (!track) return this.stop();
    if (this.assetId !== track.assetId) {
      this.stop();
      const url = this.url(track.assetId);
      if (!url) return; // still loading: tried again on the next tick
      this.audio = new Audio(url);
      this.audio.preload = "auto";
      this.assetId = track.assetId;
    }
    const audio = this.audio;
    if (!audio) return;
    // Note: iOS ignores the volume of media elements, so volume and fades are only heard in the
    // export there.
    const gain = trackGainAt(track, time, slideDuration);
    if (Math.abs(audio.volume - gain) > 0.005) audio.volume = Math.min(1, Math.max(0, gain));
    if (!playing || !trackActive(track, time, slideDuration)) {
      if (!audio.paused) audio.pause();
      return;
    }
    const target = audioTimeAt(track, time);
    if (audio.paused) {
      if (Math.abs(audio.currentTime - target) > 0.05) audio.currentTime = target;
      void audio.play().catch(() => undefined);
    } else if (Math.abs(audio.currentTime - target) > DRIFT_TOLERANCE && !audio.seeking) {
      audio.currentTime = target;
    }
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.audio = null;
    this.assetId = null;
  }
}
