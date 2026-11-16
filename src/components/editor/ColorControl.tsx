"use client";

import { Pipette } from "lucide-react";
import { PREF, pushRecent, usePref } from "@/lib/prefs";
import { useEditorStore } from "@/store/editorStore";
import { ColorField } from "../ui/primitives";

const NONE: string[] = [];

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>;
}

/** Color field with brand colors, recently used colors and (where the browser has one) an eyedropper. */
export function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const recent = usePref<string[]>(PREF.recentColors, NONE);
  const brand = useEditorStore((s) => s.brandKit?.colors) ?? NONE;
  const swatches = [...brand, ...recent.filter((c) => !brand.includes(c))].slice(0, 12);
  const EyeDropperCtor =
    typeof window !== "undefined" ? (window as unknown as { EyeDropper?: new () => EyeDropperLike }).EyeDropper : undefined;
  const commit = (hex: string) => {
    onChange(hex);
    pushRecent(PREF.recentColors, hex.toLowerCase(), 10);
  };
  return (
    <div className="space-y-1.5" onBlur={() => pushRecent(PREF.recentColors, value.slice(0, 7).toLowerCase(), 10)}>
      <ColorField label={label} value={value} onChange={onChange} />
      {(swatches.length > 0 || EyeDropperCtor) && (
        <div className="flex flex-wrap items-center gap-1">
          {EyeDropperCtor && (
            <button
              type="button"
              aria-label={`Pick ${label.toLowerCase()} from screen`}
              title="Pick a color from the screen"
              onClick={() =>
                void new EyeDropperCtor()
                  .open()
                  .then((r) => commit(r.sRGBHex))
                  .catch(() => undefined)
              }
              className="flex h-5 w-5 items-center justify-center rounded-[3px] border border-line hover:bg-sunken"
            >
              <Pipette className="h-3 w-3" />
            </button>
          )}
          {swatches.map((c, i) => (
            <button
              key={c}
              type="button"
              aria-label={`${i < brand.length ? "Brand color" : "Recent color"} ${c}`}
              title={c.toUpperCase()}
              onClick={() => commit(c)}
              style={{ background: c }}
              className={`h-5 w-5 border border-line-strong ${i < brand.length ? "rounded-full" : "rounded-[3px]"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
