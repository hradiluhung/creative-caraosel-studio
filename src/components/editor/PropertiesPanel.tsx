"use client";

import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Italic,
  Lock,
  RotateCw,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getSurface, reshapeFrame } from "@/document/geometry";
import {
  BLEND_MODES,
  IMAGE_MASKS,
  isNeutral,
  MAX_CROP_ZOOM,
  NEUTRAL_ADJUSTMENTS,
  NEUTRAL_CROP,
  type Adjustments,
  type DesignElement,
  type ImageElement,
  type OverlayElement,
  type Shadow,
  type ShapeElement,
  type StickerElement,
  type TextElement,
  type VideoElement,
  isVideoAsset,
} from "@/document/schema";
import { clampTrim, clipDuration, formatSeconds, MAX_VIDEO_SLIDE_SECONDS, videoTimeAt } from "@/document/timing";
import { VIDEO_LABEL, type VideoMime } from "@/persistence/videoSniff";
import { IMAGE_ACCEPT_ATTR } from "@/persistence/assets";
import { FILTER_PRESETS, type FilterPreset } from "@/render/adjust";
import { ensureFontsLoaded, getFont, resolveItalic, resolveWeight } from "@/render/fonts";
import { measureTextHeight } from "@/render/scene";
import { selectSelectedElements, useEditorStore } from "@/store/editorStore";
import { PREF, setPref, usePref } from "@/lib/prefs";
import { Button, IconButton, Label, NumberField, Segmented, Select, Slider, TextInput } from "../ui/primitives";
import { alignSelected, makePlaceholders, replaceImage, type AlignEdge } from "./actions";
import { ColorControl } from "./ColorControl";
import { FontPicker, useFontCatalog } from "./FontPicker";
import { BackgroundControls, Section } from "./InsertPanel";

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function useUpdate(el: DesignElement) {
  const updateElement = useEditorStore((s) => s.updateElement);
  return (p: Partial<DesignElement> | Record<string, unknown>, coalesce?: string) => updateElement(el.id, p as Partial<DesignElement>, coalesce);
}

function TextProps({ el }: { el: TextElement }) {
  const updateElement = useEditorStore((s) => s.updateElement);
  useFontCatalog(); // re-render when custom fonts are added or changed
  /** Typography changes alter the rendered height, so it is re-measured with every patch. */
  const patch = async (p: Partial<TextElement>, coalesce?: string) => {
    const next = { ...el, ...p };
    await ensureFontsLoaded([
      { family: next.fontFamily, weight: resolveWeight(next.fontFamily, next.fontWeight), italic: resolveItalic(next.fontFamily, next.italic) },
    ]);
    updateElement(el.id, { ...p, height: measureTextHeight(next) } as Partial<DesignElement>, coalesce);
  };
  const font = getFont(el.fontFamily);
  const weight = resolveWeight(el.fontFamily, el.fontWeight);
  return (
    <>
      <Section title="Typography">
        <FontPicker value={el.fontFamily} onChange={(fontFamily) => void patch({ fontFamily })} />
        {!font && <p className="text-[11px] text-danger">This font is not installed on this device, so a fallback is shown.</p>}
        <Row>
          <Select
            label="Font weight"
            value={String(weight)}
            onChange={(w) => void patch({ fontWeight: Number(w) })}
            options={(font?.weights.length ? font.weights : [weight]).map((w) => ({ value: String(w), label: WEIGHT_NAMES[w] ?? String(w) }))}
          />
          <NumberField label="Font size" prefix="Aa" min={4} max={2000} slider={{ min: 8, max: 400 }} value={el.fontSize} decimals={1} onChange={(fontSize, c) => void patch({ fontSize }, c)} />
        </Row>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Segmented
              label="Text alignment"
              value={el.align}
              onChange={(align) => void patch({ align })}
              options={[
                { value: "left", label: <AlignLeft />, title: "Align left" },
                { value: "center", label: <AlignCenter />, title: "Align center" },
                { value: "right", label: <AlignRight />, title: "Align right" },
              ]}
            />
          </div>
          <IconButton label="Italic" active={el.italic && !!font?.italics} disabled={!font?.italics} onClick={() => void patch({ italic: !el.italic })}>
            <Italic />
          </IconButton>
        </div>
        <Segmented
          label="Letter case"
          value={el.transform}
          onChange={(transform) => void patch({ transform })}
          options={[
            { value: "none", label: "Aa", title: "As typed" },
            { value: "uppercase", label: "AA", title: "Uppercase" },
            { value: "lowercase", label: "aa", title: "Lowercase" },
            { value: "capitalize", label: "Ab Cd", title: "Capitalize words" },
          ]}
        />
        <ColorControl label="Text color" value={el.fill} onChange={(fill) => void patch({ fill }, "fill")} />
        <Row>
          <NumberField label="Line height" prefix="↕" min={0.5} max={4} step={0.05} decimals={2} slider={{ min: 0.5, max: 3 }} value={el.lineHeight} onChange={(lineHeight, c) => void patch({ lineHeight }, c)} />
          <NumberField label="Letter spacing" prefix="↔" min={-50} max={400} step={0.5} decimals={1} slider={{ min: -20, max: 100 }} value={el.letterSpacing} onChange={(letterSpacing, c) => void patch({ letterSpacing }, c)} />
        </Row>
      </Section>
      <Section title="Text effects">
        <Toggle label="Outline" checked={el.strokeWidth > 0} onChange={(on) => void patch({ strokeWidth: on ? Math.max(2, Math.round(el.fontSize / 16)) : 0 })} />
        {el.strokeWidth > 0 && (
          <>
            <ColorControl label="Outline color" value={el.strokeColor} onChange={(strokeColor) => void patch({ strokeColor }, "stroke")} />
            <div className="w-1/2 pr-1">
              <NumberField label="Outline width" prefix="▭" min={0} max={200} decimals={1} slider={{ min: 0, max: 50 }} value={el.strokeWidth} onChange={(strokeWidth, c) => void patch({ strokeWidth }, c)} />
            </div>
          </>
        )}
        <Toggle
          label="Background box"
          checked={!!el.background}
          onChange={(on) => void patch({ background: on ? { color: "#f5e663", padding: Math.round(el.fontSize / 4), radius: 0 } : null })}
        />
        {el.background && (
          <>
            <ColorControl label="Box color" value={el.background.color} onChange={(color) => void patch({ background: { ...el.background!, color } }, "textbg")} />
            <Row>
              <NumberField label="Box padding" prefix="⇔" min={0} max={400} slider={{ min: 0, max: 200 }} value={el.background.padding} onChange={(padding, c) => void patch({ background: { ...el.background!, padding } }, c)} />
              <NumberField label="Box corner radius" prefix="◜" min={0} max={400} slider={{ min: 0, max: 200 }} value={el.background.radius} onChange={(radius, c) => void patch({ background: { ...el.background!, radius } }, c)} />
            </Row>
          </>
        )}
      </Section>
    </>
  );
}

function ShapeProps({ el }: { el: ShapeElement }) {
  const set = useUpdate(el);
  const isLine = el.shape === "line" || el.shape === "arrow";
  return (
    <Section title={isLine ? "Line" : "Shape"}>
      {!isLine && <ColorControl label="Fill color" value={el.fill} onChange={(fill) => set({ fill }, "fill")} />}
      <ColorControl label="Stroke color" value={el.stroke} onChange={(stroke) => set({ stroke }, "stroke")} />
      <Row>
        <NumberField label="Stroke width" prefix="▭" min={isLine ? 1 : 0} max={200} slider={{ min: isLine ? 1 : 0, max: 100 }} value={el.strokeWidth} onChange={(strokeWidth, c) => set({ strokeWidth }, c)} />
        {el.shape === "rect" && (
          <NumberField label="Corner radius" prefix="◜" min={0} max={2000} slider={{ min: 0, max: Math.ceil(Math.min(el.width, el.height) / 2) }} value={el.cornerRadius} onChange={(cornerRadius, c) => set({ cornerRadius }, c)} />
        )}
        {(el.shape === "polygon" || el.shape === "star") && (
          <NumberField label={el.shape === "star" ? "Points" : "Sides"} prefix="#" min={3} max={24} slider={{ min: 3, max: 24 }} value={el.sides} onChange={(sides, c) => set({ sides: Math.round(sides) }, c)} />
        )}
      </Row>
    </Section>
  );
}

const ADJUSTMENT_SLIDERS: Array<{ key: keyof Adjustments; label: string; min: number }> = [
  { key: "brightness", label: "Brightness", min: -100 },
  { key: "exposure", label: "Exposure", min: -100 },
  { key: "contrast", label: "Contrast", min: -100 },
  { key: "saturation", label: "Saturation", min: -100 },
  { key: "temperature", label: "Temperature", min: -100 },
  { key: "tint", label: "Tint", min: -100 },
  { key: "highlights", label: "Highlights", min: -100 },
  { key: "shadows", label: "Shadows", min: -100 },
  { key: "fade", label: "Fade", min: 0 },
  { key: "grayscale", label: "Grayscale", min: 0 },
  { key: "sharpness", label: "Sharpness", min: 0 },
  { key: "blur", label: "Blur", min: 0 },
  { key: "vignette", label: "Vignette", min: 0 },
  { key: "grain", label: "Grain", min: 0 },
];
const NO_PRESETS: FilterPreset[] = [];

/**
 * The thumb follows the finger immediately (local state); the document is updated at most
 * once per animation frame, so a fast drag never queues up more work than the screen can show.
 */
function AdjustSlider({ label, min, max = 100, value, onChange }: { label: string; min: number; max?: number; value: number; onChange: (v: number) => void }) {
  const [live, setLive] = useState<number | null>(null);
  const pending = useRef<{ value: number; frame: number } | null>(null);
  const commit = useRef(onChange);
  useEffect(() => {
    commit.current = onChange;
  });
  useEffect(() => () => {
    if (pending.current) cancelAnimationFrame(pending.current.frame);
  }, []);
  return (
    <div>
      <span className="text-[11px] text-muted">{label}</span>
      <Slider
        label={label}
        min={min}
        max={max}
        step={1}
        value={live ?? value}
        onChange={(v) => {
          setLive(v);
          if (pending.current) {
            pending.current.value = v;
            return;
          }
          const frame = requestAnimationFrame(() => {
            const next = pending.current?.value;
            pending.current = null;
            if (next !== undefined) commit.current(next);
            setLive(null);
          });
          pending.current = { value: v, frame };
        }}
      />
    </div>
  );
}

/** Mask, corner radius, border and flips: shared by photo and video frames. */
function FrameStyleControls({ el }: { el: ImageElement | VideoElement }) {
  const set = useUpdate(el);
  return (
    <>
      <Row>
        <Select label="Mask shape" value={el.mask} onChange={(mask) => set({ mask })} options={IMAGE_MASKS.map((m) => ({ value: m, label: m === "rect" ? "Rectangle" : title(m) }))} />
        {el.mask === "rect" ? (
          <NumberField label="Corner radius" prefix="◜" min={0} max={4000} slider={{ min: 0, max: Math.ceil(Math.min(el.width, el.height) / 2) }} value={el.cornerRadius} onChange={(cornerRadius, c) => set({ cornerRadius }, c)} />
        ) : (
          <span />
        )}
      </Row>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <NumberField label="Border width" prefix="▭" min={0} max={400} slider={{ min: 0, max: 100 }} value={el.borderWidth} onChange={(borderWidth, c) => set({ borderWidth }, c)} />
        </div>
        <IconButton label="Flip horizontal" active={el.flipX} onClick={() => set({ flipX: !el.flipX })}>
          <FlipHorizontal2 />
        </IconButton>
        <IconButton label="Flip vertical" active={el.flipY} onClick={() => set({ flipY: !el.flipY })}>
          <FlipVertical2 />
        </IconButton>
      </div>
      {el.borderWidth > 0 && <ColorControl label="Border color" value={el.borderColor} onChange={(borderColor) => set({ borderColor }, "border")} />}
    </>
  );
}

const FRAME_SHAPES = [
  { label: "1:1", ratio: 1 },
  { label: "4:5", ratio: 4 / 5 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
];

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function VideoProps({ el }: { el: VideoElement }) {
  const set = useUpdate(el);
  const asset = useEditorStore((s) => s.project?.assets.find((a) => a.id === el.assetId));
  // Every video that was imported into this project can be put into this frame without importing it again.
  const videoAssets = useEditorStore(useShallow((s) => s.project?.assets.filter(isVideoAsset) ?? []));
  const playback = useEditorStore((s) => s.playback);
  const playhead = useEditorStore((s) => s.playhead);
  const source = asset?.duration ?? el.trimEnd;
  const trim = (start: number, end: number) => set(clampTrim(start, end, source));
  const speeds = SPEEDS.includes(el.playbackRate) ? SPEEDS : [...SPEEDS, el.playbackRate].sort((a, b) => a - b);
  return (
    <>
      <Section title="Video">
        <p className="text-[11px] text-muted" data-testid="video-info">
          {asset
            ? `${VIDEO_LABEL[asset.mime as VideoMime] ?? asset.mime} · ${asset.width} × ${asset.height} · ${formatSeconds(source)} · plays ${formatSeconds(clipDuration(el))}`
            : "The video file of this layer is missing on this device."}
        </p>
        {videoAssets.length > 1 && (
          <Select
            label="Video file"
            value={el.assetId}
            onChange={(assetId) => {
              const next = videoAssets.find((a) => a.id === assetId);
              if (!next || next.id === el.assetId) return;
              // Same frame, same place on the timeline, another file: start again from its beginning.
              set({ assetId: next.id, name: next.name.replace(/\.[^.]+$/, "") || "Video", posterTime: 0, ...clampTrim(0, Math.min(next.duration ?? 1, MAX_VIDEO_SLIDE_SECONDS - el.start), next.duration ?? 1) });
            }}
            options={videoAssets.map((a) => ({ value: a.id, label: `${a.name} (${formatSeconds(a.duration ?? 0)})` }))}
          />
        )}
        <Row>
          <NumberField label="Trim start" prefix="[" min={0} max={source} step={0.1} decimals={2} value={el.trimStart} onChange={(v) => trim(v, Math.max(el.trimEnd, v))} />
          <NumberField label="Trim end" prefix="]" min={0} max={source} step={0.1} decimals={2} value={el.trimEnd} onChange={(v) => trim(Math.min(el.trimStart, v), v)} />
        </Row>
        <Row>
          <Select label="Speed" value={String(el.playbackRate)} onChange={(v) => set({ playbackRate: Number(v) })} options={speeds.map((v) => ({ value: String(v), label: `${v}×` }))} />
          <NumberField label="Poster time" prefix="▣" min={0} max={source} step={0.1} decimals={2} value={el.posterTime} onChange={(posterTime) => set({ posterTime })} />
        </Row>
        <NumberField label="Starts at" prefix="▸" min={0} max={59.9} step={0.1} decimals={2} value={el.start} onChange={(start) => set({ start })} />
        <Button size="sm" className="w-full" disabled={playback === "stopped"} onClick={() => set({ posterTime: Math.min(source, Number(videoTimeAt(el, playhead).toFixed(2))) })}>
          Use current frame as poster
        </Button>
        <div>
          <span className="text-[11px] text-muted">Volume</span>
          <Slider label="Volume" min={0} max={1} step={0.01} value={el.volume} display={`${Math.round(el.volume * 100)}%`} onChange={(volume) => set({ volume }, "volume")} />
        </div>
        <div className="flex gap-4">
          <Toggle label="Mute" checked={el.muted} onChange={(muted) => set({ muted })} />
          <Toggle label="Loop" checked={el.loop} onChange={(loop) => set({ loop })} />
        </div>
        <p className="text-[11px] text-muted">The poster frame is what thumbnails and image exports show. Trim, speed and poster time are in seconds.</p>
      </Section>
      <Section title="Frame">
        <FrameStyleControls el={el} />
        <p className="text-[11px] text-muted">
          The video always fills its frame. Resize the frame from a side handle to crop. Filters and adjustments are for photos only: they cannot be applied to video in real time.
        </p>
      </Section>
    </>
  );
}

function ImageProps({ el }: { el: ImageElement }) {
  const set = useUpdate(el);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [showAdjust, setShowAdjust] = useState(false);
  const saved = usePref<FilterPreset[]>(PREF.imagePresets, NO_PRESETS);
  const asset = useEditorStore((s) => s.project?.assets.find((a) => a.id === el.assetId));
  const crop = el.crop ?? NEUTRAL_CROP;
  const natural = asset && asset.width > 0 && asset.height > 0 ? (crop.turns % 2 ? asset.height / asset.width : asset.width / asset.height) : null;
  const setCrop = (patch: Partial<typeof crop>, coalesce = true) => set({ crop: { ...crop, ...patch } }, coalesce ? `crop:${Object.keys(patch)[0]}` : undefined);
  const applyPreset = (preset: FilterPreset | null) =>
    set({ adjustments: { ...NEUTRAL_ADJUSTMENTS, ...(preset?.adjustments ?? {}) }, filter: preset?.name ?? null });

  return (
    <>
      <Section title="Image">
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTR}
          hidden
          data-testid="replace-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void replaceImage(el.id, file).then(setError);
          }}
        />
        <Button className="w-full" onClick={() => fileRef.current?.click()}>
          <ImagePlus className="h-4 w-4" /> {el.assetId ? "Replace photo" : "Choose photo"}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <FrameStyleControls el={el} />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Frame shape">
          {[...(natural ? [{ label: "As photo", ratio: natural }] : []), ...FRAME_SHAPES].map((shape) => (
            <button
              key={shape.label}
              type="button"
              aria-label={`Frame shape ${shape.label}`}
              aria-pressed={Math.abs(el.width / el.height - shape.ratio) < 0.01}
              onClick={() => set(reshapeFrame(el, shape.ratio))}
              className="h-6 rounded-full border border-line px-2 text-[11px] font-medium text-muted hover:text-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bg"
            >
              {shape.label}
            </button>
          ))}
        </div>
        {el.assetId && (
          <Button size="sm" variant="ghost" className="-ml-2" onClick={() => makePlaceholders([el.id])}>
            Turn into empty frame
          </Button>
        )}
      </Section>

      {el.assetId && (
        <Section title="Crop">
          <AdjustSlider label="Zoom" min={100} max={MAX_CROP_ZOOM * 100} value={Math.round(crop.zoom * 100)} onChange={(v) => setCrop({ zoom: v / 100 })} />
          <AdjustSlider label="Move left / right" min={-100} value={Math.round(crop.x * 100)} onChange={(v) => setCrop({ x: v / 100 })} />
          <AdjustSlider label="Move up / down" min={-100} value={Math.round(crop.y * 100)} onChange={(v) => setCrop({ y: v / 100 })} />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setCrop({ turns: ((crop.turns + 1) % 4) as 0 | 1 | 2 | 3 }, false)}>
              <RotateCw className="h-3.5 w-3.5" /> Rotate photo 90°
            </Button>
            <Button size="sm" variant="ghost" disabled={!el.crop} onClick={() => set({ crop: undefined })}>
              Reset crop
            </Button>
          </div>
          <p className="text-[11px] text-muted">The photo always fills its frame. Moving only has an effect where the frame hides part of the photo: zoom in, or use a frame with a different shape.</p>
        </Section>
      )}

      <Section title="Color effects">
        <Toggle
          label="Duotone"
          checked={!!el.duotone}
          onChange={(on) => set({ duotone: on ? { shadow: "#1b1f5e", highlight: "#ffd9a8", amount: 100 } : undefined })}
        />
        {el.duotone && (
          <>
            <ColorControl label="Duotone dark color" value={el.duotone.shadow} onChange={(shadow) => set({ duotone: { ...el.duotone!, shadow } }, "duo-shadow")} />
            <ColorControl label="Duotone light color" value={el.duotone.highlight} onChange={(highlight) => set({ duotone: { ...el.duotone!, highlight } }, "duo-highlight")} />
            <AdjustSlider label="Duotone strength" min={0} value={el.duotone.amount} onChange={(amount) => set({ duotone: { ...el.duotone!, amount } }, "duo-amount")} />
          </>
        )}
        <Toggle label="Color overlay" checked={!!el.overlay} onChange={(on) => set({ overlay: on ? { color: "#e5388a", opacity: 35 } : undefined })} />
        {el.overlay && (
          <>
            <ColorControl label="Overlay color" value={el.overlay.color} onChange={(color) => set({ overlay: { ...el.overlay!, color } }, "overlay-color")} />
            <AdjustSlider label="Overlay opacity" min={0} value={el.overlay.opacity} onChange={(opacity) => set({ overlay: { ...el.overlay!, opacity } }, "overlay-opacity")} />
          </>
        )}
      </Section>

      <Section title="Filters">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter presets">
          {[null, ...FILTER_PRESETS, ...saved].map((preset) => {
            const active = preset ? el.filter === preset.name : isNeutral(el.adjustments);
            const custom = !!preset && saved.includes(preset);
            return (
              <span key={preset?.id ?? "none"} className="inline-flex">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => applyPreset(preset)}
                  className={`h-6 border px-2 text-[11px] font-medium ${custom ? "rounded-l-full" : "rounded-full"} ${active ? "border-ink bg-ink text-bg" : "border-line text-muted hover:text-ink"}`}
                >
                  {preset?.name ?? "Original"}
                </button>
                {custom && (
                  <button
                    type="button"
                    aria-label={`Delete preset ${preset.name}`}
                    onClick={() => setPref(PREF.imagePresets, saved.filter((p) => p.id !== preset.id))}
                    className="flex h-6 w-5 items-center justify-center rounded-r-full border border-l-0 border-line text-muted hover:text-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <Button size="sm" variant="ghost" className="-ml-2" aria-expanded={showAdjust} onClick={() => setShowAdjust(!showAdjust)}>
          {showAdjust ? "Hide adjustments" : "Adjust manually"}
        </Button>
        {showAdjust && (
          <div className="space-y-1">
            {ADJUSTMENT_SLIDERS.map(({ key, label, min }) => (
              <AdjustSlider
                key={key}
                label={label}
                min={min}
                value={el.adjustments[key]}
                onChange={(v) => set({ adjustments: { ...el.adjustments, [key]: v }, filter: null }, `adj:${key}`)}
              />
            ))}
            <div className="flex gap-2 pt-1">
              <TextInput aria-label="Preset name" placeholder="Preset name" maxLength={24} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <Button
                size="sm"
                className="h-8"
                disabled={!presetName.trim() || isNeutral(el.adjustments)}
                onClick={() => {
                  const preset = { id: `custom-${Date.now()}`, name: presetName.trim(), adjustments: el.adjustments };
                  setPref(PREF.imagePresets, [...saved, preset]);
                  set({ filter: preset.name });
                  setPresetName("");
                }}
              >
                Save preset
              </Button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

function ColorOnlyProps({ el }: { el: StickerElement | OverlayElement }) {
  const set = useUpdate(el);
  if (el.type === "overlay" && el.overlay === "grain") {
    return (
      <Section title="Overlay">
        <p className="text-xs text-muted">Use opacity and blend mode to control how strong the grain is.</p>
      </Section>
    );
  }
  return (
    <Section title={el.type === "sticker" ? "Sticker" : "Overlay"}>
      <ColorControl label="Color" value={el.color} onChange={(color) => set({ color }, "color")} />
    </Section>
  );
}

const DEFAULT_SHADOW: Shadow = { color: "#000000", opacity: 0.35, blur: 24, offsetX: 0, offsetY: 12 };

function EffectsProps({ el }: { el: DesignElement }) {
  const set = useUpdate(el);
  const sh = el.shadow;
  return (
    <Section title="Effects">
      <div>
        <Label>Blend mode</Label>
        <div className="mt-1">
          <Select label="Blend mode" value={el.blendMode} onChange={(blendMode) => set({ blendMode })} options={BLEND_MODES.map((m) => ({ value: m, label: title(m) }))} />
        </div>
      </div>
      {el.type !== "overlay" && (
        <>
          <Toggle label="Drop shadow" checked={!!sh} onChange={(on) => set({ shadow: on ? DEFAULT_SHADOW : null })} />
          {sh && (
            <>
              <ColorControl label="Shadow color" value={sh.color} onChange={(color) => set({ shadow: { ...sh, color } }, "shadow")} />
              <Row>
                <NumberField label="Shadow blur" prefix="◌" min={0} max={400} slider={{ min: 0, max: 200 }} value={sh.blur} onChange={(blur, c) => set({ shadow: { ...sh, blur } }, c)} />
                <NumberField label="Shadow opacity" prefix="%" min={0} max={100} slider={{ min: 0, max: 100 }} value={Math.round(sh.opacity * 100)} onChange={(o, c) => set({ shadow: { ...sh, opacity: o / 100 } }, c)} />
              </Row>
              <Row>
                <NumberField label="Shadow offset X" prefix="X" min={-500} max={500} slider={{ min: -200, max: 200 }} value={sh.offsetX} onChange={(offsetX, c) => set({ shadow: { ...sh, offsetX } }, c)} />
                <NumberField label="Shadow offset Y" prefix="Y" min={-500} max={500} slider={{ min: -200, max: 200 }} value={sh.offsetY} onChange={(offsetY, c) => set({ shadow: { ...sh, offsetY } }, c)} />
              </Row>
            </>
          )}
        </>
      )}
    </Section>
  );
}

const ALIGN: Array<{ edge: AlignEdge; label: string; icon: React.ReactNode }> = [
  { edge: "left", label: "Align to slide left", icon: <AlignStartVertical /> },
  { edge: "center", label: "Center horizontally on slide", icon: <AlignCenterVertical /> },
  { edge: "right", label: "Align to slide right", icon: <AlignEndVertical /> },
  { edge: "top", label: "Align to slide top", icon: <AlignStartHorizontal /> },
  { edge: "middle", label: "Center vertically on slide", icon: <AlignCenterHorizontal /> },
  { edge: "bottom", label: "Align to slide bottom", icon: <AlignEndHorizontal /> },
];

export function PropertiesPanel() {
  const selected = useEditorStore(useShallow(selectSelectedElements));
  const project = useEditorStore((s) => s.project);
  const activeSurfaceId = useEditorStore((s) => s.activeSurfaceId);
  const updateSelected = useEditorStore((s) => s.updateSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);

  if (!project) return null;

  if (selected.length === 0) {
    const surface = getSurface(project, activeSurfaceId);
    return (
      <div>
        <Section title="Canvas">
          <p className="text-xs text-muted">
            {project.mode === "seamless"
              ? `Seamless panorama · ${surface?.width} × ${surface?.height} px · ${project.slides.length} slides of ${project.width} px`
              : `Slide ${project.slides.findIndex((s) => s.id === activeSurfaceId) + 1} of ${project.slides.length} · ${project.width} × ${project.height} px`}
          </p>
          <BackgroundControls />
        </Section>
        <p className="px-3.5 py-3 text-xs text-muted">Select a layer to edit its properties.</p>
      </div>
    );
  }

  const single = selected.length === 1 ? selected[0] : null;
  const allLocked = selected.every((e) => e.locked);
  const opacity = selected[0].opacity;

  return (
    <div>
      <Section title={single ? single.name || "Layer" : `${selected.length} layers selected`}>
        <div className="flex items-center gap-0.5">
          {ALIGN.map((a) => (
            <IconButton key={a.edge} label={a.label} disabled={allLocked} onClick={() => alignSelected(a.edge)}>
              {a.icon}
            </IconButton>
          ))}
        </div>
        {single && (
          <>
            <Row>
              <NumberField label="X position" prefix="X" value={single.x} onChange={(x) => updateSelected({ x })} />
              <NumberField label="Y position" prefix="Y" value={single.y} onChange={(y) => updateSelected({ y })} />
            </Row>
            <Row>
              <NumberField label="Width" prefix="W" min={4} max={30000} slider={{ min: 4, max: (project?.width ?? 1080) * 2 }} value={single.width} onChange={(width, c) => updateSelected(single.type === "text" ? ({ width, height: measureTextHeight({ ...single, width }) } as Partial<DesignElement>) : { width }, c)} />
              {single.type === "text" ? (
                <div className="flex h-8 items-center rounded-[5px] border border-dashed border-line px-2 text-xs text-muted" title="Text height follows its content">
                  H auto
                </div>
              ) : (
                <NumberField label="Height" prefix="H" min={4} max={30000} slider={{ min: 4, max: (project?.height ?? 1350) * 2 }} value={single.height} onChange={(height, c) => updateSelected({ height }, c)} />
              )}
            </Row>
            <Row>
              <NumberField label="Rotation" prefix="∠" min={-360} max={360} decimals={1} slider={{ min: 0, max: 360 }} value={single.rotation} onChange={(rotation, c) => updateSelected({ rotation: ((rotation % 360) + 360) % 360 }, c)} />
            </Row>
          </>
        )}
        <Slider label="Opacity" min={0} max={1} step={0.01} value={opacity} display={`${Math.round(opacity * 100)}%`} onChange={(o) => updateSelected({ opacity: o }, "opacity")} />
        <div className="flex items-center gap-0.5">
          <IconButton label="Duplicate" onClick={duplicateSelected}>
            <Copy />
          </IconButton>
          <IconButton label={allLocked ? "Unlock" : "Lock"} active={allLocked} onClick={() => updateSelected({ locked: !allLocked })}>
            {allLocked ? <Lock /> : <Unlock />}
          </IconButton>
          <IconButton label="Delete" onClick={deleteSelected}>
            <Trash2 />
          </IconButton>
        </div>
      </Section>
      {single?.type === "text" && <TextProps key={single.id} el={single} />}
      {single?.type === "shape" && <ShapeProps el={single} />}
      {single?.type === "image" && <ImageProps key={single.id} el={single} />}
      {single?.type === "video" && <VideoProps key={single.id} el={single} />}
      {(single?.type === "sticker" || single?.type === "overlay") && <ColorOnlyProps el={single} />}
      {single && <EffectsProps el={single} />}
    </div>
  );
}
