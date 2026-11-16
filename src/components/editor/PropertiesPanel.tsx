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
  Italic,
  Lock,
  Trash2,
  Unlock,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { getSurface } from "@/document/geometry";
import type { DesignElement, ImageElement, ShapeElement, TextElement } from "@/document/schema";
import { ensureFontsLoaded, FONT_CATALOG, getFont, resolveItalic, resolveWeight } from "@/render/fonts";
import { measureTextHeight } from "@/render/scene";
import { selectSelectedElements, useEditorStore } from "@/store/editorStore";
import { ColorField, IconButton, NumberField, Segmented, Select, Slider } from "../ui/primitives";
import { alignSelected, type AlignEdge } from "./actions";
import { BackgroundControls, Section } from "./InsertPanel";

const WEIGHT_NAMES: Record<number, string> = { 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold" };

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function TextProps({ el }: { el: TextElement }) {
  const updateElement = useEditorStore((s) => s.updateElement);
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
    <Section title="Typography">
      <Select
        label="Font family"
        value={el.fontFamily}
        onChange={(fontFamily) => void patch({ fontFamily })}
        options={FONT_CATALOG.map((f) => ({ value: f.family, label: f.family, group: f.category }))}
      />
      <Row>
        <Select
          label="Font weight"
          value={String(weight)}
          onChange={(w) => void patch({ fontWeight: Number(w) })}
          options={(font?.weights ?? [weight]).map((w) => ({ value: String(w), label: WEIGHT_NAMES[w] ?? String(w) }))}
        />
        <NumberField label="Font size" prefix="Aa" min={4} max={2000} value={el.fontSize} decimals={1} onChange={(fontSize) => void patch({ fontSize })} />
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
      <ColorField label="Text color" value={el.fill} onChange={(fill) => void patch({ fill }, "fill")} />
      <Row>
        <NumberField label="Line height" prefix="↕" min={0.5} max={4} step={0.05} decimals={2} value={el.lineHeight} onChange={(lineHeight) => void patch({ lineHeight })} />
        <NumberField label="Letter spacing" prefix="↔" min={-50} max={400} step={0.5} decimals={1} value={el.letterSpacing} onChange={(letterSpacing) => void patch({ letterSpacing })} />
      </Row>
    </Section>
  );
}

function ShapeProps({ el }: { el: ShapeElement }) {
  const updateElement = useEditorStore((s) => s.updateElement);
  const set = (p: Partial<ShapeElement>, coalesce?: string) => updateElement(el.id, p as Partial<DesignElement>, coalesce);
  const isLine = el.shape === "line" || el.shape === "arrow";
  return (
    <Section title={isLine ? "Line" : "Shape"}>
      {!isLine && <ColorField label="Fill color" value={el.fill} onChange={(fill) => set({ fill }, "fill")} />}
      <ColorField label="Stroke color" value={el.stroke} onChange={(stroke) => set({ stroke }, "stroke")} />
      <Row>
        <NumberField label="Stroke width" prefix="▭" min={isLine ? 1 : 0} max={200} value={el.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
        {el.shape === "rect" && (
          <NumberField label="Corner radius" prefix="◜" min={0} max={2000} value={el.cornerRadius} onChange={(cornerRadius) => set({ cornerRadius })} />
        )}
        {(el.shape === "polygon" || el.shape === "star") && (
          <NumberField label={el.shape === "star" ? "Points" : "Sides"} prefix="#" min={3} max={24} value={el.sides} onChange={(sides) => set({ sides: Math.round(sides) })} />
        )}
      </Row>
    </Section>
  );
}

function ImageProps({ el }: { el: ImageElement }) {
  const updateElement = useEditorStore((s) => s.updateElement);
  return (
    <Section title="Image">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <NumberField label="Corner radius" prefix="◜" min={0} max={4000} value={el.cornerRadius} onChange={(cornerRadius) => updateElement(el.id, { cornerRadius } as Partial<DesignElement>)} />
        </div>
        <IconButton label="Flip horizontal" active={el.flipX} onClick={() => updateElement(el.id, { flipX: !el.flipX } as Partial<DesignElement>)}>
          <FlipHorizontal2 />
        </IconButton>
        <IconButton label="Flip vertical" active={el.flipY} onClick={() => updateElement(el.id, { flipY: !el.flipY } as Partial<DesignElement>)}>
          <FlipVertical2 />
        </IconButton>
      </div>
      <p className="text-[11px] text-muted">The image always fills its frame. Resize the frame from a side handle to crop.</p>
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
              <NumberField label="Width" prefix="W" min={4} max={30000} value={single.width} onChange={(width) => updateSelected(single.type === "text" ? ({ width, height: measureTextHeight({ ...single, width }) } as Partial<DesignElement>) : { width })} />
              {single.type === "text" ? (
                <div className="flex h-8 items-center rounded-[5px] border border-dashed border-line px-2 text-xs text-muted" title="Text height follows its content">
                  H auto
                </div>
              ) : (
                <NumberField label="Height" prefix="H" min={4} max={30000} value={single.height} onChange={(height) => updateSelected({ height })} />
              )}
            </Row>
            <Row>
              <NumberField label="Rotation" prefix="∠" min={-360} max={360} decimals={1} value={single.rotation} onChange={(rotation) => updateSelected({ rotation: ((rotation % 360) + 360) % 360 })} />
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
      {single?.type === "image" && <ImageProps el={single} />}
    </div>
  );
}
