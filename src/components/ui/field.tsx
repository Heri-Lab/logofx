import * as React from "react";
import { useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Figma-style numeric field: a quiet filled box with a prefix label or icon. Drag the prefix
 * to scrub (Shift for ×10), type a value and press Enter, or use ↑/↓ (Shift for ×10).
 */
export function NumberField({ prefix, value, onChange, min = -Infinity, max = Infinity, step = 1, suffix = "", wrap, label, className }: {
  prefix: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** Wrap around instead of clamping (angles). */
  wrap?: boolean;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const scrub = useRef<{ x: number; v: number } | null>(null);
  const fit = (v: number) => {
    const r = Math.round(v / step) * step;
    if (wrap && Number.isFinite(min) && Number.isFinite(max)) {
      const span = max - min;
      return ((((r - min) % span) + span) % span) + min;
    }
    return clamp(r, min, max);
  };
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft.replace(/[^\d.+-]/g, ""));
    if (Number.isFinite(n)) onChange(fit(n));
    setDraft(null);
  };
  return (
    <label
      className={cn(
        "group flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-[5px] border border-transparent bg-muted pl-1.5 pr-2 text-[11px] transition-colors hover:border-input focus-within:border-ring",
        className,
      )}
    >
      <span
        className="grid h-full min-w-3 cursor-ew-resize touch-none select-none place-items-center text-muted-foreground [&_svg]:size-3"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, v: value };
        }}
        onPointerMove={(e) => {
          const s = scrub.current;
          if (!s) return;
          onChange(fit(s.v + Math.round((e.clientX - s.x) / 2) * step * (e.shiftKey ? 10 : 1)));
        }}
        onPointerUp={() => { scrub.current = null; }}
        onPointerCancel={() => { scrub.current = null; }}
      >
        {prefix}
      </span>
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft ?? `${+value.toFixed(2)}${suffix}`}
        onFocus={(e) => { setDraft(String(+value.toFixed(2))); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); }
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = fit(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            onChange(n);
            setDraft(String(n));
          }
        }}
        className="w-full min-w-0 bg-transparent tabular-nums outline-none"
      />
    </label>
  );
}

/** Colour swatch + hex field; the swatch opens the native colour picker. */
export function ColorField({ value, onChange, label, mixed }: { value: string; onChange: (hex: string) => void; label: string; mixed?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const hex = draft.replace(/[^0-9a-f]/gi, "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    if (full.length === 6) onChange(`#${full.toLowerCase()}`);
    setDraft(null);
  };
  return (
    <div className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-[5px] border border-transparent bg-muted px-1.5 text-[11px] transition-colors hover:border-input focus-within:border-ring">
      <label className="relative size-3.5 shrink-0 cursor-pointer overflow-hidden rounded-[3px] ring-1 ring-inset ring-white/20" style={{ background: value }}>
        <input type="color" aria-label={`${label} picker`} value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <input
        aria-label={label}
        value={draft ?? (mixed ? "Mixed" : value.replace("#", "").toUpperCase())}
        onFocus={(e) => { setDraft(value.replace("#", "").toUpperCase()); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.currentTarget.blur(); } else if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); } }}
        className={cn("w-full min-w-0 bg-transparent tabular-nums outline-none", !(mixed && draft === null) && "uppercase")}
      />
    </div>
  );
}

/** Figma-style checkbox row. */
export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className="group flex h-6 items-center gap-2 text-left text-[11px] text-foreground outline-none">
      <span
        className={cn(
          "grid size-3.5 shrink-0 place-items-center rounded-[3px] transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring/50",
          checked ? "bg-primary text-primary-foreground" : "border border-white/40 group-hover:border-white/70",
        )}
      >
        {checked && <Check className="size-2.5" strokeWidth={3.5} />}
      </span>
      {children}
    </button>
  );
}

/** Small uppercase-free field caption, Figma style. */
export const FieldLabel = ({ children }: { children: React.ReactNode }) => <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{children}</p>;

/**
 * Panel section with a title row, separated from the next by a hairline. Passing `onToggle`
 * makes it foldable; folded, it shows only the title and a one-line `summary`.
 */
export function Section({ title, actions, children, className, collapsed, onToggle, summary }: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  summary?: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-3 border-b border-border px-4 pt-3", collapsed ? "pb-3" : "pb-4", className)}>
      <div className="-mr-1.5 flex h-6 items-center justify-between gap-2">
        {onToggle ? (
          <button onClick={onToggle} aria-expanded={!collapsed} className="-ml-1 flex min-w-0 flex-1 items-center gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")} />
            <h3 className="text-[11px] font-semibold">{title}</h3>
            {collapsed && summary && <span className="ml-auto truncate pl-2 pr-1.5 text-[11px] text-muted-foreground">{summary}</span>}
          </button>
        ) : (
          <h3 className="text-[11px] font-semibold">{title}</h3>
        )}
        {actions && !collapsed && <div className="flex items-center">{actions}</div>}
      </div>
      {!collapsed && children}
    </section>
  );
}
