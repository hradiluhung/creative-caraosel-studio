"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

export function Button({
  variant = "outline",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium whitespace-nowrap transition-colors disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-[13px]",
        variant === "primary" && "bg-ink text-bg hover:opacity-90",
        variant === "outline" && "border border-line-strong bg-panel hover:bg-sunken",
        variant === "ghost" && "hover:bg-sunken",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...props}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] text-ink transition-colors disabled:opacity-30 [&_svg]:h-4 [&_svg]:w-4",
        active ? "bg-ink text-bg" : "hover:bg-sunken",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-[11px] font-medium tracking-wide text-muted uppercase">
      {children}
    </label>
  );
}

const inputClass =
  "h-8 w-full min-w-0 rounded-[5px] border border-line bg-panel px-2 text-[13px] text-ink outline-none focus:border-ink";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={cn(inputClass, props.className)} />;
}

export function Select({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; group?: string }>;
  label: string;
  className?: string;
}) {
  const groups = new Map<string, typeof options>();
  for (const o of options) groups.set(o.group ?? "", [...(groups.get(o.group ?? "") ?? []), o]);
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, "pr-1", className)}>
      {[...groups.entries()].map(([group, items]) =>
        group ? (
          <optgroup key={group} label={group}>
            {items.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          items.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        ),
      )}
    </select>
  );
}

/** Numeric field that only commits valid numbers (Enter, blur or arrow keys). */
export function NumberField({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  decimals = 0,
  prefix,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  prefix?: string;
  disabled?: boolean;
}) {
  const format = (n: number) => String(Number(n.toFixed(decimals)));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    setDraft(null);
    if (raw.trim() === "" || !Number.isFinite(n)) return;
    const clamped = Math.min(max, Math.max(min, n));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <div className="relative min-w-0">
      {prefix && (
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted">{prefix}</span>
      )}
      <input
        aria-label={label}
        title={label}
        disabled={disabled}
        inputMode="decimal"
        value={draft ?? format(value)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            commit(String(value + delta));
          }
        }}
        className={cn(inputClass, "tabular-nums", prefix && "pl-6")}
      />
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  display,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  display?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 min-w-0 flex-1"
      />
      <span className="w-10 text-right text-xs text-muted tabular-nums">{display ?? value}</span>
    </div>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const base = value.slice(0, 7);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={base}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-9 shrink-0 cursor-pointer rounded-[5px] border border-line bg-panel p-0.5"
      />
      <input
        aria-label={`${label} hex`}
        value={draft ?? base.toUpperCase()}
        maxLength={7}
        spellCheck={false}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
          setDraft(v);
          if (HEX.test(v)) onChange(v.toLowerCase());
        }}
        onBlur={() => setDraft(null)}
        className={cn(inputClass, "font-mono uppercase")}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[5px] border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          aria-label={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 flex-1 items-center justify-center rounded-[3px] px-2 text-xs font-medium [&_svg]:h-3.5 [&_svg]:w-3.5",
            value === o.value ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    // Move focus into the dialog, and give it back to whatever opened the dialog afterwards.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  /** Keep Tab inside the dialog: a modal that lets focus wander behind it cannot be used by keyboard. */
  const trapFocus = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !ref.current) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return e.preventDefault();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onMouseDown={onClose} onKeyDown={trapFocus}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="pb-safe flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-line bg-panel shadow-2xl outline-none sm:max-w-md sm:rounded-lg"
      >
        <h2 id={titleId} className="border-b border-line px-5 py-3.5 text-[15px] font-semibold">
          {title}
        </h2>
        <div className="thin-scroll overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Mobile bottom sheet. It takes layout space, so the canvas above it stays visible and interactive. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div
      role="dialog"
      aria-label={title}
      className="z-30 flex max-h-[46dvh] shrink-0 flex-col border-t border-line bg-panel"
    >
      <div className="flex items-center justify-between border-b border-line py-1.5 pr-2 pl-4">
        <span className="text-xs font-semibold tracking-wide uppercase">{title}</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
      <div className="thin-scroll overflow-y-auto">{children}</div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Small floating menu positioned at viewport coordinates. */
export function FloatingMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEscape(onClose);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);
  return (
    <div className="fixed inset-0 z-50" onPointerDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        role="menu"
        style={pos}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute min-w-44 rounded-md border border-line bg-panel py-1 shadow-xl"
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "block w-full px-3 py-2 text-left text-[13px] hover:bg-sunken disabled:opacity-40 md:py-1.5",
              item.danger && "text-danger",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
