import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Copy, FlipHorizontal2, FlipVertical2, Lock, MoreHorizontal, Plus, RotateCcw, RotateCcwSquare, RotateCwSquare, Sparkles, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/popover";
import { GridGenerator } from "@/components/GridGenerator";
import type { Layer } from "@/lib/generator";
import { notify } from "@/store/notice";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Segmented, SegmentedItem } from "@/components/ui/toggle-group";
import { DENSITIES, GRID_SPACE, TEMPLATES, IDENTITY, baseKeyOf, getTemplate, isIdentity, type Density, type GridTemplate } from "@/lib/templates";
import { loadRegions, useRegions } from "@/lib/regions";
import { LINE_COLORS, useEditor, useTransform } from "@/store/editor";
import { cn } from "@/lib/utils";

export function Sidebar() {
  return (
    <aside className="flex w-[348px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_12px_28px_#0000001f]">
      <GridLibrary />
      <GridSettings />
    </aside>
  );
}

function GridLibrary() {
  const templateId = useEditor((s) => s.templateId);
  const density = useEditor((s) => s.density);
  const customs = useEditor((s) => s.customGrids);
  const [gen, setGen] = useState<{ open: boolean; initial?: { name: string; layers: Layer[] } }>({ open: false });
  return (
    <div className="scroll-area min-h-0 flex-1 px-[19px] pb-3 pt-4">
      <div className="mb-2 flex h-7 items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">My grids</h3>
        <Button variant="ghost" size="sm" className="-mr-2 h-7 text-xs text-brand hover:text-brand" onClick={() => setGen({ open: true })}>
          <Sparkles className="size-3.5" />
          Generate
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2" role="listbox" aria-label="My grids">
        <button
          onClick={() => setGen({ open: true })}
          className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-input text-muted-foreground outline-none transition-colors hover:border-ring hover:bg-background/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" />
          <span className="text-[11px]">New grid</span>
        </button>
        {customs.map((g) => (
          <CustomTile key={g.id} id={g.id} name={g.name} active={g.id === templateId} onEdit={() => setGen({ open: true, initial: { name: g.name, layers: g.layers } })} />
        ))}
      </div>

      <h3 className="mb-2 mt-5 text-xs font-medium text-muted-foreground">Templates</h3>
      <div className="grid grid-cols-3 gap-2" role="listbox" aria-label="Template grids">
        {TEMPLATES.map((t) => (
          <TemplateTile key={t.id} t={t} active={t.id === templateId} density={density} />
        ))}
      </div>
      <Button variant="outline" className="mt-3 h-11 w-full gap-2 bg-muted/30 font-normal">
        <Lock className="size-3.5" />
        Join to unlock all grids (24)
      </Button>
      <GridGenerator open={gen.open} onOpenChange={(open) => setGen((g) => ({ ...g, open }))} initial={gen.initial} />
    </div>
  );
}

function CustomTile({ id, name, active, onEdit }: { id: string; name: string; active: boolean; onEdit: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="group relative">
      <TemplateTile t={getTemplate(id)} active={active} density={16} />
      <DropdownMenu onOpenChange={(o) => !o && setConfirm(false)}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Options for ${name}`}
            className="absolute right-1 top-1 grid size-6 place-items-center rounded-sm bg-card/90 text-muted-foreground opacity-0 shadow-sm outline-none backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="w-48">
          <DropdownMenuItem onSelect={onEdit}><Copy />Duplicate &amp; edit</DropdownMenuItem>
          <DropdownMenuItem
            className={cn("text-destructive data-[highlighted]:text-destructive [&_svg]:text-destructive", confirm && "bg-destructive/10")}
            onSelect={(e) => {
              if (!confirm) { e.preventDefault(); setConfirm(true); return; }
              useEditor.getState().deleteCustomGrid(id);
              notify(`Deleted “${name}”`);
            }}
          >
            <Trash2 />
            {confirm ? "Click again to delete" : "Delete grid"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const prefetch = (id: string, density: number) =>
  void loadRegions(id, density, useEditor.getState().transforms[baseKeyOf(id, density)] ?? IDENTITY);

const TemplateTile = memo(function TemplateTile({ t, active, density }: { t: GridTemplate; active: boolean; density: number }) {
  return (
    <Tip label={t.name} side="bottom">
      <button
        role="option"
        aria-selected={active}
        aria-label={t.name}
        // Build the shapes in the background before the click lands.
        onPointerEnter={() => prefetch(t.id, density)}
        onFocus={() => prefetch(t.id, density)}
        onClick={() => useEditor.getState().setTemplate(t.id)}
        className={cn(
          "relative aspect-square overflow-hidden rounded-md bg-background/40 p-[5px] outline-none transition-[box-shadow,background-color] duration-150 [contain:paint]",
          "hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring",
          active ? "ring-2 ring-brand ring-inset" : "ring-1 ring-inset ring-white/[0.04]",
        )}
      >
        <svg viewBox={`0 0 ${GRID_SPACE} ${GRID_SPACE}`} className="size-full" aria-hidden>
          <path d={t.path(16)} fill="none" stroke="var(--muted-foreground)" strokeOpacity={active ? 0.95 : 0.7} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
        </svg>
      </button>
    </Tip>
  );
});

function GridSettings() {
  const [tab, setTab] = useState<"grid" | "transform">("grid");
  const s = useEditor(
    useShallow((st) => ({
      templateId: st.templateId, density: st.density, resetSettings: st.resetSettings, resetTransform: st.resetTransform,
    })),
  );
  const t = getTemplate(s.templateId);
  const xf = useTransform();
  const { regions, loading } = useRegions(s.templateId, s.density, xf);
  const transformed = !isIdentity(xf);
  return (
    <section className="flex flex-col gap-3.5 border-t border-border px-[19px] pb-5 pt-4">
      <div className="-mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Grid settings</h3>
        <div className="flex items-center gap-1">
          <Segmented type="single" value={tab} onValueChange={(v) => v && setTab(v as typeof tab)} aria-label="Settings section">
            <SegmentedItem value="grid">Grid</SegmentedItem>
            <SegmentedItem value="transform" className="relative">
              Transform
              {transformed && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-brand" aria-label="Grid is transformed" />}
            </SegmentedItem>
          </Segmented>
          <Tip label={tab === "grid" ? "Reset grid settings" : "Reset transform"}>
            <Button variant="ghost" size="icon-sm" aria-label="Reset" className="text-muted-foreground" onClick={tab === "grid" ? s.resetSettings : s.resetTransform}>
              <RotateCcw className="size-3.5" />
            </Button>
          </Tip>
        </div>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground tabular-nums">
        {t.name}
        {transformed && " (transformed)"} · {loading || !regions ? "building shapes…" : `${regions.count} drawable shapes`}
      </p>
      {tab === "grid" ? <GridTab usesDensity={!!t.usesDensity} /> : <TransformTab />}
    </section>
  );
}

function GridTab({ usesDensity }: { usesDensity: boolean }) {
  const s = useEditor(
    useShallow((st) => ({
      density: st.density, lineOpacity: st.lineOpacity, lineColor: st.lineColor, hoverPreview: st.hoverPreview,
      guidesOnExport: st.guidesOnExport, setDensity: st.setDensity, setSettings: st.setSettings,
    })),
  );
  return (
    <>
      <Row label="Density">
        <Tip label={usesDensity ? "Cells per side" : "Density applies to the square grid"}>
          <div>
            <Segmented type="single" value={String(s.density)} onValueChange={(v) => v && s.setDensity(+v as Density)} disabled={!usesDensity} aria-label="Density">
              {DENSITIES.map((d) => (
                <SegmentedItem key={d} value={String(d)}>{d}</SegmentedItem>
              ))}
            </Segmented>
          </div>
        </Tip>
      </Row>
      <Row label="Line opacity">
        <div className="ml-6 flex flex-1 items-center gap-3">
          <Slider value={[s.lineOpacity]} min={0} max={60} step={1} onValueChange={([v]) => s.setSettings({ lineOpacity: v })} aria-label="Line opacity" />
          <span className="w-10 text-right text-xs tabular-nums">{s.lineOpacity}%</span>
        </div>
      </Row>
      <Row label="Line color">
        <div className="flex gap-1.5" role="radiogroup" aria-label="Line color">
          {LINE_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={s.lineColor === c}
              aria-label={c}
              onClick={() => s.setSettings({ lineColor: c })}
              className={cn("size-4 rounded-full transition-transform hover:scale-110", s.lineColor === c && "ring-2 ring-brand ring-offset-2 ring-offset-card")}
              style={{ background: c }}
            />
          ))}
        </div>
      </Row>
      <Row label="Highlight shape on hover">
        <Switch checked={s.hoverPreview} onCheckedChange={(v) => s.setSettings({ hoverPreview: v })} aria-label="Highlight shape on hover" />
      </Row>
      <Row label="Show guides on export">
        <Switch checked={s.guidesOnExport} onCheckedChange={(v) => s.setSettings({ guidesOnExport: v })} aria-label="Show guides on export" />
      </Row>
    </>
  );
}

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

function TransformTab() {
  const xf = useTransform();
  const set = useEditor((st) => st.setTransform);
  return (
    <>
      <TransformRow label="Rotate" value={xf.rotate} min={-180} max={180} step={1} fallback={0} format={(v) => `${v}°`} onChange={(rotate) => set({ rotate })} />
      <TransformRow label="Scale" value={Math.round(xf.scale * 100)} min={50} max={300} step={1} fallback={100} format={(v) => `${v}%`} onChange={(v) => set({ scale: v / 100 })} />
      <TransformRow label="Offset X" value={xf.x} min={-120} max={120} step={1} fallback={0} format={(v) => `${v}`} onChange={(x) => set({ x })} />
      <TransformRow label="Offset Y" value={xf.y} min={-120} max={120} step={1} fallback={0} format={(v) => `${v}`} onChange={(y) => set({ y })} />
      <TransformRow label="Tilt X" hint="Perspective: tilt the top edge away" value={xf.tiltX ?? 0} min={-60} max={60} step={1} fallback={0} format={(v) => `${v}°`} onChange={(tiltX) => set({ tiltX })} />
      <TransformRow label="Tilt Y" hint="Perspective: tilt the right edge away" value={xf.tiltY ?? 0} min={-60} max={60} step={1} fallback={0} format={(v) => `${v}°`} onChange={(tiltY) => set({ tiltY })} />
      <Row label="Quick">
        <div className="flex gap-1">
          <Tip label="Rotate 90° left">
            <Button variant="outline" size="icon-sm" aria-label="Rotate 90° left" onClick={() => set({ rotate: wrapDeg(xf.rotate - 90) })}><RotateCcwSquare className="size-3.5" /></Button>
          </Tip>
          <Tip label="Rotate 90° right">
            <Button variant="outline" size="icon-sm" aria-label="Rotate 90° right" onClick={() => set({ rotate: wrapDeg(xf.rotate + 90) })}><RotateCwSquare className="size-3.5" /></Button>
          </Tip>
          <Tip label="Flip horizontal">
            <Button variant="outline" size="icon-sm" aria-label="Flip horizontal" aria-pressed={xf.flipX} className={cn(xf.flipX && "bg-accent text-brand")} onClick={() => set({ flipX: !xf.flipX })}><FlipVertical2 className="size-3.5" /></Button>
          </Tip>
          <Tip label="Flip vertical">
            <Button variant="outline" size="icon-sm" aria-label="Flip vertical" aria-pressed={xf.flipY} className={cn(xf.flipY && "bg-accent text-brand")} onClick={() => set({ flipY: !xf.flipY })}><FlipHorizontal2 className="size-3.5" /></Button>
          </Tip>
        </div>
      </Row>
    </>
  );
}

function TransformRow({ label, hint, value, min, max, step, fallback, format, onChange }: {
  label: string; hint?: string; value: number; min: number; max: number; step: number; fallback: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex min-h-6 items-center gap-3">
      <span className="w-16 shrink-0 whitespace-nowrap text-xs text-muted-foreground" title={hint}>{label}</span>
      <div className="flex flex-1 items-center gap-3">
        <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} aria-label={label} />
        <Tip label="Click to reset">
          <button
            onClick={() => onChange(fallback)}
            className={cn("w-10 rounded-sm text-right text-xs tabular-nums transition-colors hover:text-foreground", value === fallback ? "text-muted-foreground" : "text-foreground")}
          >
            {format(value)}
          </button>
        </Tip>
      </div>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex min-h-6 items-center justify-between gap-3">
    <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
    {children}
  </div>
);
