/**
 * Decoded sound for export.
 *
 * The sound of a clip is read with the same demuxer that reads its pictures (mediabunny, see
 * frameSource.ts), so sound and picture share one timeline: edit lists, start offsets and
 * encoder priming are applied the same way to both. Every audio track of the file is tried, so a
 * file whose first sound track cannot be decoded here (for example a spatial audio track next to
 * the normal stereo one, or AC-3 next to AAC) still exports with its sound.
 *
 * `decodeAudioData` is only the fallback for browsers without WebCodecs audio decoding. It reads
 * only some containers (Safari, for example, does not read QuickTime movies with it) and ignores
 * edit lists, which is why it is no longer the main path.
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, type InputAudioTrack } from "mediabunny";

/** Sound of one source range. `buffer` sample 0 is source time `offset` (seconds). */
export interface DecodedAudio {
  buffer: AudioBuffer;
  offset: number;
}

export type AudioDecodeResult =
  | { status: "ok"; audio: DecodedAudio }
  /** The file has no sound track (or nothing in the requested range). */
  | { status: "none" }
  /** The file has sound, but this browser cannot decode it. */
  | { status: "failed"; reason: string };

/** Sound tracks in the order to try them: the file's primary track first, then the others. */
async function orderedAudioTracks(input: Input): Promise<InputAudioTrack[]> {
  const all = await input.getAudioTracks();
  const primary = await input.getPrimaryAudioTrack().catch(() => null);
  return primary ? [primary, ...all.filter((t) => t !== primary)] : all;
}

/**
 * Decode one track between `from` and `to` (source seconds) into a single AudioBuffer.
 * Returns null when the track produced no sound data in that range.
 */
async function decodeTrackRange(track: InputAudioTrack, from: number, to: number, ctx: BaseAudioContext, check: () => void): Promise<DecodedAudio | null> {
  const sink = new AudioBufferSink(track);
  let target: AudioBuffer | null = null;
  let channels = 0;
  let rate = 0;
  for await (const chunk of sink.buffers(from, to)) {
    check();
    const src = chunk.buffer;
    if (!target) {
      // Allocated from the first decoded chunk: HE-AAC, for example, decodes at twice the rate
      // the container announces.
      rate = src.sampleRate;
      channels = Math.max(1, Math.min(src.numberOfChannels, 8));
      const length = Math.max(1, Math.ceil((to - from) * rate));
      target = ctx.createBuffer(channels, length, rate);
    }
    // Where this chunk lands in the target, in samples. A chunk may begin before `from`.
    const at = Math.round((chunk.timestamp - from) * rate);
    const skip = Math.max(0, -at);
    const count = Math.min(src.length - skip, target.length - Math.max(0, at));
    if (count <= 0) continue;
    for (let c = 0; c < channels; c++) {
      const data = src.getChannelData(Math.min(c, src.numberOfChannels - 1));
      target.copyToChannel(data.subarray(skip, skip + count), c, Math.max(0, at));
    }
  }
  return target ? { buffer: target, offset: from } : null;
}

/** Fallback without WebCodecs audio: the browser's own decoder, whole file, timeline starting at 0. */
async function decodeWithWebAudio(blob: Blob, ctx: BaseAudioContext): Promise<DecodedAudio | null> {
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return { buffer, offset: 0 };
  } catch {
    return null;
  }
}

/**
 * The sound of `blob` between source times `from` and `to`.
 * `ctx` is the context the result will be played in (its buffers are created there).
 */
export async function decodeAudioRange(blob: Blob, from: number, to: number, ctx: BaseAudioContext, check: () => void = () => undefined): Promise<AudioDecodeResult> {
  if (!(to > from)) return { status: "none" };
  let input: Input | null = null;
  let tracks: InputAudioTrack[] | null = null;
  let codecs = "";
  try {
    input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    tracks = await orderedAudioTracks(input);
    codecs = (await Promise.all(tracks.map((t) => t.getCodec().catch(() => null)))).filter(Boolean).join(", ");
  } catch {
    tracks = null; // not a container the demuxer knows: let the browser try below
  }
  try {
    if (tracks && tracks.length === 0) return { status: "none" };
    if (tracks && typeof AudioDecoder !== "undefined") {
      let emptyInRange = false;
      for (const track of tracks) {
        check();
        if (!(await track.canDecode().catch(() => false))) continue;
        try {
          const audio = await decodeTrackRange(track, from, to, ctx, check);
          if (audio) return { status: "ok", audio };
          emptyInRange = true;
        } catch {
          check(); // a cancelled export stops here instead of trying other tracks
          /* try the next track, then the browser's own decoder */
        }
      }
      // Decodable but empty in this range (for example the sound track is shorter than the clip).
      if (emptyInRange) return { status: "none" };
    }
  } finally {
    input?.dispose();
  }
  const fallback = await decodeWithWebAudio(blob, ctx);
  if (fallback) return { status: "ok", audio: fallback };
  if (tracks && tracks.length > 0) {
    return { status: "failed", reason: codecs ? `its sound (${codecs}) cannot be decoded by this browser` : "its sound cannot be decoded by this browser" };
  }
  // Neither the demuxer nor the browser could read the file: most likely there is no sound at all.
  return { status: "none" };
}
