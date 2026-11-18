import { memo, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowLeftRight, ArrowUpDown, ArrowUpFromLine, Blend as BlendIcon, ChevronDown, Copy, Eye, EyeOff, FlipHorizontal2, FlipVertical2, GripVertical, Lock, LockOpen,
  Merge, MoreHorizontal, MoveDiagonal, Plus, RotateCcw, RotateCcwSquare, RotateCw, RotateCwSquare, Scaling, Scan, Sparkles, Spline, Sun, SunDim, Trash2, Video,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/popover";
import { GridGenerator } from "@/components/GridGenerator";
import { AIPanel } from "@/components/AIPanel";
import type { Layer as GridLayer } from "@/lib/generator";
import { notify } from "@/store/notice";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Segmented, SegmentedItem } from "@/components/ui/toggle-group";
import { Checkbox, ColorField, FieldLabel, NumberField, Section } from "@/components/ui/field";
import { DENSITIES, GRID_SPACE, TEMPLATES, IDENTITY, baseKeyOf, getTemplate, isIdentity, type Density, type GridTemplate } from "@/lib/templates";
import { loadRegions, useRegions } from "@/lib/regions";
import { commitFaceDepth, useFaceInfo } from "@/lib/faces";
import {
  BLENDS, BUILTIN_CAMERAS, EMPTY_FILLS, LINE_COLORS, layer3d, unpackFill, useEditor, useGridKey, useTransform,
  type BevelProfile, type Blend, type Layer, type Material, type PanelTab, type Projection,
} from "@/store/editor";
import { cn } from "@/lib/utils";

const TABS: { id: PanelTab; label: string }[] = [
  { id: "layers", label: "Layers" },
  { id: "grids", label: "Grids" },
  { id: "assistant", label: "Assistant" },
];

/**
 * Left panel: what is in the drawing — layers, the grid library and the assistant chat.
 * The assistant's prompt stays pinned at the bottom of every tab.
 */
export function LeftPanel() {
  const stored = useEditor((s) => s.panelTab);
  const tab: PanelTab = TABS.some((t) => t.id === stored) ? stored : "layers";
  const setTab = (t: PanelTab) => useEditor.getState().setPanelTab(t);
  return (
    <aside className="flex w-[260px] shrink-0 flex-col overflow-hidden border-r border-border bg-card">
      <nav className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-2" role="tablist" aria-label="Panel">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "h-7 rounded-[5px] px-2 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              tab === t.id ? "bg-muted font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "layers" && <LayerList />}
      {tab === "grids" && <GridLibrary />}
      <AIPanel expanded={tab === "assistant"} onSend={() => setTab("assistant")} />
    </aside>
  );
}

/**
 * Right panel: properties of what is selected, most-used first. 3D sections appear while the
 * canvas is tilted; grid set-up sits at the bottom, folded by default.
 */
export function DesignPanel() {
  const is3D = useEditor((s) => s.view3d.enabled);
  const ed = useEditor.getState;
  return (
    <aside className="flex w-[260px] shrink-0 flex-col overflow-hidden border-l border-border bg-card">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border pl-4 pr-3">
        <h2 className="text-[11px] font-semibold">Design</h2>
        <div className="flex items-center gap-1">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-muted-foreground">
            3D
            <button
              role="switch"
              aria-checked={is3D}
              aria-label="Tilt canvas into 3D"
              onClick={() => ed().set3D({ enabled: !is3D })}
              className={cn("relative h-4 w-7 rounded-full transition-colors", is3D ? "bg-primary" : "bg-input")}
            >
              <span className={cn("absolute top-0.5 size-3 rounded-full bg-white transition-[left]", is3D ? "left-3.5" : "left-0.5")} />
            </button>
          </label>
          {is3D && <ResetButton label="Reset 3D" onClick={() => ed().reset3D()} />}
        </div>
      </header>
      <div className="scroll-area min-h-0 flex-1">
        <LayerProperties />
        {is3D && <ThreeDSections />}
        <GridSettings />
        <TransformSettings />
      </div>
    </aside>
  );
}

/* ---------------- Grids ---------------- */

function GridLibrary() {
  const templateId = useEditor((s) => s.templateId);
  const density = useEditor((s) => s.density);
  const customs = useEditor((s) => s.customGrids);
  const [gen, setGen] = useState<{ open: boolean; initial?: { name: string; layers: GridLayer[] } }>({ open: false });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-area min-h-0 flex-1 px-4 pb-3 pt-3">
        <div className="mb-2 flex h-6 items-center justify-between">
          <h3 className="text-[11px] font-semibold">My grids</h3>
          <Button variant="ghost" size="sm" className="-mr-2 h-6 gap-1 px-2 text-[11px] text-brand hover:text-brand" onClick={() => setGen({ open: true })}>
            <Sparkles className="size-3" />
            Generate
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2" role="listbox" aria-label="My grids">
          <button
            onClick={() => setGen({ open: true })}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[5px] border border-dashed border-input text-muted-foreground outline-none transition-colors hover:border-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-4" />
            <span className="text-[11px]">New grid</span>
          </button>
          {customs.map((g) => (
            <CustomTile key={g.id} id={g.id} name={g.name} active={g.id === templateId} onEdit={() => setGen({ open: true, initial: { name: g.name, layers: g.layers } })} />
          ))}
        </div>

        <h3 className="mb-2 mt-4 text-[11px] font-semibold">Templates</h3>
        <div className="grid grid-cols-3 gap-2" role="listbox" aria-label="Template grids">
          {TEMPLATES.map((t) => (
            <TemplateTile key={t.id} t={t} active={t.id === templateId} density={density} />
          ))}
        </div>
      </div>
      <div className="shrink-0 px-4 pb-4 pt-2">
        <Button variant="secondary" className="h-8 w-full gap-2 text-[11px] font-medium">
          <Lock className="size-3" />
          Join to unlock all grids (24)
        </Button>
      </div>
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
          "relative aspect-square overflow-hidden rounded-[5px] bg-white/[0.03] p-1 outline-none transition-[box-shadow,background-color] duration-150 [contain:paint]",
          "hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring",
          active ? "ring-2 ring-brand ring-inset" : "ring-1 ring-inset ring-white/[0.06]",
        )}
      >
        <svg viewBox={`0 0 ${GRID_SPACE} ${GRID_SPACE}`} className="size-full" aria-hidden>
          <path d={t.path(16)} fill="none" stroke="var(--muted-foreground)" strokeOpacity={active ? 0.95 : 0.7} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
        </svg>
      </button>
    </Tip>
  );
});

/* ---------------- Settings ---------------- */

/** Fold state of a Design panel section, remembered across sessions. */
const useFold = (id: string) => {
  const collapsed = useEditor((s) => !!s.collapsed[id]);
  return { collapsed, onToggle: () => useEditor.getState().toggleSection(id) };
};

const ResetButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Tip label={label}>
    <Button variant="ghost" size="icon-sm" aria-label={label} className="size-6 text-muted-foreground [&_svg]:size-3.5" onClick={onClick}>
      <RotateCcw />
    </Button>
  </Tip>
);

function GridSettings() {
  const s = useEditor(
    useShallow((st) => ({
      templateId: st.templateId, density: st.density, lineOpacity: st.lineOpacity, lineColor: st.lineColor, hoverPreview: st.hoverPreview,
      guidesOnExport: st.guidesOnExport, setDensity: st.setDensity, setSettings: st.setSettings, resetSettings: st.resetSettings,
    })),
  );
  const t = getTemplate(s.templateId);
  const xf = useTransform();
  const { regions, loading } = useRegions(s.templateId, s.density, xf);
  const usesDensity = !!t.usesDensity;
  const fold = useFold("grid");
  return (
    <Section
      title="Grid"
      {...fold}
      summary={usesDensity ? `${t.name} · ${s.density} × ${s.density}` : t.name}
      actions={<ResetButton label="Reset grid settings" onClick={s.resetSettings} />}
    >
      <p className="-mt-1.5 text-[11px] text-muted-foreground tabular-nums">
        {t.name}
        {!isIdentity(xf) && " (transformed)"} · {loading || !regions ? "building shapes…" : `${regions.count} drawable shapes`}
      </p>
      <div>
        <FieldLabel>Density</FieldLabel>
        <Tip label={usesDensity ? "Cells per side" : "Density applies to the square grid"}>
          <div>
            <Segmented type="single" value={String(s.density)} onValueChange={(v) => v && s.setDensity(+v as Density)} disabled={!usesDensity} aria-label="Density" className="rounded-[5px]">
              {DENSITIES.map((d) => (
                <SegmentedItem key={d} value={String(d)} className="flex-1 text-[11px]">{d}</SegmentedItem>
              ))}
            </Segmented>
          </div>
        </Tip>
      </div>
      <div>
        <FieldLabel>Line</FieldLabel>
        <div className="flex gap-2">
          <ColorField label="Line color" value={s.lineColor} onChange={(lineColor) => s.setSettings({ lineColor })} />
          <NumberField label="Line opacity" className="max-w-[84px]" prefix={<BlendIcon />} value={s.lineOpacity} min={0} max={100} suffix="%" onChange={(lineOpacity) => s.setSettings({ lineOpacity })} />
        </div>
        <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Line color presets">
          {LINE_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={s.lineColor === c}
              aria-label={c}
              onClick={() => s.setSettings({ lineColor: c })}
              className={cn("size-4 rounded-[3px] ring-1 ring-inset ring-white/15 transition-transform hover:scale-110", s.lineColor === c && "ring-2 ring-brand ring-offset-1 ring-offset-card")}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <div className="-my-0.5 flex flex-col">
        <Checkbox checked={s.hoverPreview} onChange={(hoverPreview) => s.setSettings({ hoverPreview })}>Highlight shape on hover</Checkbox>
        <Checkbox checked={s.guidesOnExport} onChange={(guidesOnExport) => s.setSettings({ guidesOnExport })}>Show guides on export</Checkbox>
      </div>
    </Section>
  );
}

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

function TransformSettings() {
  const xf = useTransform();
  const set = useEditor((st) => st.setTransform);
  const reset = useEditor((st) => st.resetTransform);
  const fold = useFold("transform");
  const quick = "h-6 flex-1 rounded-[5px] bg-muted [&_svg]:size-3.5 hover:bg-input";
  return (
    <Section
      title="Grid transform"
      {...fold}
      summary={isIdentity(xf) ? "None" : "Transformed"}
      actions={<ResetButton label="Reset transform" onClick={reset} />}
    >
      <div>
        <FieldLabel>Position</FieldLabel>
        <div className="flex gap-2">
          <NumberField label="Offset X" prefix="X" value={xf.x} min={-120} max={120} onChange={(x) => set({ x })} />
          <NumberField label="Offset Y" prefix="Y" value={xf.y} min={-120} max={120} onChange={(y) => set({ y })} />
        </div>
      </div>
      <div>
        <FieldLabel>Rotation &amp; scale</FieldLabel>
        <div className="flex gap-2">
          <NumberField label="Rotate" prefix={<RotateCw />} value={xf.rotate} min={-180} max={180} wrap suffix="°" onChange={(rotate) => set({ rotate })} />
          <NumberField label="Scale" prefix={<Scaling />} value={Math.round(xf.scale * 100)} min={50} max={300} suffix="%" onChange={(v) => set({ scale: v / 100 })} />
        </div>
      </div>
      <div>
        <FieldLabel>Perspective tilt</FieldLabel>
        <div className="flex gap-2">
          <Tip label="Tilt the top edge away">
            <NumberField label="Tilt X" prefix={<ArrowLeftRight />} value={xf.tiltX ?? 0} min={-60} max={60} suffix="°" onChange={(tiltX) => set({ tiltX })} />
          </Tip>
          <Tip label="Tilt the right edge away">
            <NumberField label="Tilt Y" prefix={<ArrowUpDown />} value={xf.tiltY ?? 0} min={-60} max={60} suffix="°" onChange={(tiltY) => set({ tiltY })} />
          </Tip>
        </div>
      </div>
      <div>
        <FieldLabel>Quick actions</FieldLabel>
        <div className="flex gap-2">
          <Tip label="Rotate 90° left">
            <Button variant="ghost" size="icon" className={quick} aria-label="Rotate 90° left" onClick={() => set({ rotate: wrapDeg(xf.rotate - 90) })}><RotateCcwSquare /></Button>
          </Tip>
          <Tip label="Rotate 90° right">
            <Button variant="ghost" size="icon" className={quick} aria-label="Rotate 90° right" onClick={() => set({ rotate: wrapDeg(xf.rotate + 90) })}><RotateCwSquare /></Button>
          </Tip>
          <Tip label="Flip horizontal">
            <Button variant="ghost" size="icon" aria-label="Flip horizontal" aria-pressed={xf.flipX} className={cn(quick, xf.flipX && "bg-primary/20 text-brand")} onClick={() => set({ flipX: !xf.flipX })}><FlipVertical2 /></Button>
          </Tip>
          <Tip label="Flip vertical">
            <Button variant="ghost" size="icon" aria-label="Flip vertical" aria-pressed={xf.flipY} className={cn(quick, xf.flipY && "bg-primary/20 text-brand")} onClick={() => set({ flipY: !xf.flipY })}><FlipHorizontal2 /></Button>
          </Tip>
        </div>
      </div>
    </Section>
  );
}

/* ---------------- Layers ---------------- */

/** Per-layer shape counts and colours on the current grid. */
function useLayerStats() {
  const key = useGridKey();
  const fills = useEditor((s) => s.fills[key] ?? EMPTY_FILLS);
  return useMemo(() => {
    const stats = new Map<string, { count: number; colors: Set<string> }>();
    for (const v of Object.values(fills)) {
      const { layer, color } = unpackFill(v);
      const st = stats.get(layer) ?? stats.set(layer, { count: 0, colors: new Set() }).get(layer)!;
      st.count++;
      st.colors.add(color);
    }
    return { key, stats };
  }, [key, fills]);
}

/** Left panel: the layer stack, top layer first. */
function LayerList() {
  const layers = useEditor((s) => s.layers);
  const active = useEditor((s) => s.activeLayer);
  const ink = useEditor((s) => s.ink);
  const { stats } = useLayerStats();
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const ed = useEditor.getState;
  const current = layers.find((l) => l.id === active) ?? layers[0];
  const top = [...layers].reverse();

  return (
      <div className="scroll-area min-h-0 flex-1 px-2 pb-3 pt-2">
        <div className="flex h-8 items-center justify-between pl-2 pr-0.5">
          <h3 className="text-[11px] font-semibold">
            Layers <span className="ml-1 font-normal text-muted-foreground">{layers.length}</span>
          </h3>
          <Tip label="Add layer">
            <Button variant="ghost" size="icon-sm" className="size-6 [&_svg]:size-3.5" aria-label="Add layer" onClick={() => ed().addLayer()}><Plus /></Button>
          </Tip>
        </div>
        <ul className="flex flex-col" role="listbox" aria-label="Layers">
          {top.map((l, i) => (
            <LayerRow
              key={l.id}
              layer={l}
              active={l.id === current.id}
              count={stats.get(l.id)?.count ?? 0}
              swatch={[...(stats.get(l.id)?.colors ?? [])][0] ?? (l.id === current.id ? ink : undefined)}
              dropBefore={drag?.over === i && drag.id !== l.id}
              onDragStart={() => setDrag({ id: l.id, over: i })}
              onDragOver={() => drag && drag.over !== i && setDrag({ ...drag, over: i })}
              onDrop={() => {
                if (drag) ed().moveLayer(drag.id, layers.length - 1 - drag.over);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            />
          ))}
        </ul>
        <p className="px-2 pt-2 text-[11px] leading-[1.45] text-muted-foreground">
          Shapes you fill go into the selected layer. Each shape belongs to one layer; drag rows to reorder.
        </p>
      </div>
  );
}

/** Design panel: fill, opacity and blend of the selected layer. */
function LayerProperties() {
  const layers = useEditor((s) => s.layers);
  const active = useEditor((s) => s.activeLayer);
  const ink = useEditor((s) => s.ink);
  const { key, stats } = useLayerStats();
  const ed = useEditor.getState;
  const current = layers.find((l) => l.id === active) ?? layers[0];
  const st = stats.get(current.id);
  const colors = st ? [...st.colors] : [];
  return (
      <Section
        title={<>{current.name} <span className="ml-1 font-normal text-muted-foreground">{st?.count ?? 0} shapes</span></>}
        actions={
          <>
            <Tip label="Merge down">
              <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground [&_svg]:size-3.5" aria-label="Merge down" disabled={layers[0].id === current.id} onClick={() => ed().mergeDown(current.id)}><Merge /></Button>
            </Tip>
            <Tip label="Delete layer">
              <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground [&_svg]:size-3.5" aria-label="Delete layer" disabled={layers.length <= 1} onClick={() => { ed().deleteLayer(current.id); notify(`Deleted “${current.name}”`); }}><Trash2 /></Button>
            </Tip>
          </>
        }
      >
        <div>
          <FieldLabel>Fill</FieldLabel>
          <div className="flex gap-2">
            <ColorField
              label="Layer fill"
              value={colors[0] ?? ink}
              mixed={colors.length > 1}
              onChange={(c) => (st ? ed().recolorLayer(key, current.id, c) : ed().setInk(c))}
            />
            <NumberField label="Layer opacity" className="max-w-[84px]" prefix={<BlendIcon />} value={current.opacity} min={0} max={100} suffix="%" onChange={(opacity) => ed().updateLayer(current.id, { opacity })} />
          </div>
        </div>
        <div>
          <FieldLabel>Blend</FieldLabel>
          <label className="relative flex h-6 items-center rounded-[5px] border border-transparent bg-muted text-[11px] transition-colors hover:border-input focus-within:border-ring">
            <select
              aria-label="Blend mode"
              value={current.blend}
              onChange={(e) => ed().updateLayer(current.id, { blend: e.target.value as Blend })}
              className="size-full appearance-none bg-transparent pl-2 pr-6 capitalize outline-none"
            >
              {BLENDS.map((b) => <option key={b} value={b} className="bg-popover capitalize">{b}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground" />
          </label>
        </div>
      </Section>
  );
}

function LayerRow({ layer, active, count, swatch, dropBefore, onDragStart, onDragOver, onDrop, onDragEnd }: {
  layer: Layer; active: boolean; count: number; swatch?: string; dropBefore: boolean;
  onDragStart: () => void; onDragOver: () => void; onDrop: () => void; onDragEnd: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const update = (patch: Partial<Layer>) => useEditor.getState().updateLayer(layer.id, patch);
  const icon = "grid size-6 shrink-0 place-items-center rounded-[4px] text-muted-foreground outline-none transition-[color,opacity] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5";
  return (
    <li
      role="option"
      aria-selected={active}
      draggable={!editing}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      onClick={() => useEditor.getState().selectLayer(layer.id)}
      className={cn(
        "group relative flex h-8 cursor-default items-center gap-1.5 rounded-[5px] pl-1 pr-1 text-[11px]",
        active ? "bg-primary/20" : "hover:bg-white/[0.05]",
        dropBefore && "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-brand",
      )}
    >
      <GripVertical className="size-3 shrink-0 cursor-grab text-muted-foreground/50" />
      <span className="size-3.5 shrink-0 rounded-[3px] ring-1 ring-inset ring-white/20" style={{ background: swatch ?? "transparent" }} />
      <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", !layer.visible && "opacity-50")}>
        {editing ? (
          <input
            autoFocus
            defaultValue={layer.name}
            aria-label="Layer name"
            onFocus={(e) => e.target.select()}
            onBlur={(e) => { update({ name: e.target.value.trim() || layer.name }); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(false); }}
            className="h-5 min-w-0 flex-1 rounded-[3px] bg-background px-1 outline-none ring-1 ring-ring"
          />
        ) : (
          <span className={cn("truncate", active && "font-semibold")} onDoubleClick={() => setEditing(true)}>{layer.name}</span>
        )}
        <span className="shrink-0 text-muted-foreground tabular-nums">{count}</span>
      </span>
      <button
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        onClick={(e) => { e.stopPropagation(); update({ visible: !layer.visible }); }}
        className={cn(icon, layer.visible && !active && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
      >
        {layer.visible ? <Eye /> : <EyeOff />}
      </button>
      <button
        aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
        onClick={(e) => { e.stopPropagation(); update({ locked: !layer.locked }); }}
        className={cn(icon, !layer.locked && !active && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
      >
        {layer.locked ? <Lock /> : <LockOpen />}
      </button>
    </li>
  );
}

/* ---------------- 3D ---------------- */

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Segmented type="single" value={value} onValueChange={(v) => v && onChange(v as T)} aria-label={label} className="rounded-[5px]">
      {options.map((o) => <SegmentedItem key={o.id} value={o.id} className="flex-1 text-[11px]">{o.label}</SegmentedItem>)}
    </Segmented>
  );
}

/** 3D sections of the Design panel, shown while the canvas is tilted. */
function ThreeDSections() {
  const v = useEditor((s) => s.view3d);
  const saved = useEditor((s) => s.cameras);
  const layers = useEditor((s) => s.layers);
  const activeId = useEditor((s) => s.activeLayer);
  const { stats } = useLayerStats();
  const ed = useEditor.getState;
  const face = useFaceInfo();
  const layer = face?.layer ?? layers.find((l) => l.id === activeId) ?? layers[0];
  const l3 = layer3d(layer);
  const st = stats.get(layer.id);
  const faceColor = st ? [...st.colors][0] : undefined;
  const cams = [...BUILTIN_CAMERAS, ...saved];
  const setLayer = (patch: Partial<Layer>) => ed().updateLayer(layer.id, patch);

  return (
    <>
      <Section
        title={
          <span className="flex items-center gap-1.5">
            3D face
            <span className="flex h-[18px] min-w-0 items-center gap-1 rounded bg-primary/20 px-1.5 text-[10px] font-semibold text-[#7cc4ff]">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: (face?.color ?? faceColor) ?? "transparent" }} />
              <span className="truncate">{face ? `${face.ids.length} shape${face.ids.length === 1 ? "" : "s"} · ${layer.name}` : `${layer.name} · all faces`}</span>
            </span>
          </span>
        }
        actions={
          <Tip label="Pick a face on the canvas (X)">
            <Button variant="ghost" size="icon-sm" className={cn("size-6 text-muted-foreground [&_svg]:size-3.5", v.enabled && useEditor.getState().tool === "extrude" && "text-brand")} aria-label="Extrude tool" onClick={() => ed().setTool("extrude")}>
              <ArrowUpFromLine />
            </Button>
          </Tip>
        }
      >
        <div className="-mt-1 flex gap-2">
          <div className="flex-1">
            <FieldLabel>Extrude</FieldLabel>
            {/* With a face picked this extrudes just that face; otherwise it sets the layer's default. */}
            <NumberField
              label="Extrude"
              prefix={<ArrowUpFromLine />}
              value={face ? face.depth : l3.extrude}
              min={0}
              max={120}
              suffix=" px"
              onChange={(extrude) => (face ? commitFaceDepth(face.key, face.ids, extrude) : setLayer({ extrude }))}
            />
          </div>
          <div className="flex-1">
            <FieldLabel>Bevel</FieldLabel>
            <NumberField label="Bevel" prefix={<Spline />} value={l3.bevel} min={0} max={6} step={0.5} suffix=" px" onChange={(bevel) => setLayer({ bevel })} />
          </div>
        </div>
        <div>
          <FieldLabel>Bevel profile</FieldLabel>
          <Seg<BevelProfile> label="Bevel profile" value={l3.profile} onChange={(profile) => setLayer({ profile })} options={[{ id: "chamfer", label: "Chamfer" }, { id: "round", label: "Round" }, { id: "step", label: "Step" }]} />
        </div>
        <div>
          <FieldLabel>Side color</FieldLabel>
          <div className="flex gap-2">
            <ColorField label="Side color" value={l3.sideColor ?? face?.color ?? faceColor ?? "#888888"} onChange={(sideColor) => setLayer({ sideColor })} />
            <Button variant="ghost" size="sm" className={cn("h-6 rounded-[5px] bg-muted px-2 text-[11px]", !l3.sideColor && "text-brand")} onClick={() => setLayer({ sideColor: null })}>
              Auto
            </Button>
          </div>
        </div>
        <p className="text-[11px] leading-[1.45] text-muted-foreground">
          {face ? (
            <>
              Extrude applies to the picked face only; bevel and side colour to all of {layer.name}.{" "}
              {face.depth !== l3.extrude && (
                <button className="text-brand hover:underline" onClick={() => commitFaceDepth(face.key, face.ids, null)}>Use layer depth ({l3.extrude} px)</button>
              )}
            </>
          ) : (
            "With the Extrude tool (X), click a face on the canvas and drag up to raise just that face."
          )}
        </p>
      </Section>

      <Section title="View" actions={<Tip label="Save current view as a camera"><Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground [&_svg]:size-3.5" aria-label="Save camera" onClick={() => ed().saveCamera()}><Plus /></Button></Tip>}>
        <div className="-mt-1">
          <FieldLabel>Active camera</FieldLabel>
          <label className="relative flex h-6 items-center rounded-[5px] border border-transparent bg-muted text-[11px] transition-colors hover:border-input focus-within:border-ring">
            <Video className="pointer-events-none absolute left-1.5 size-3 text-muted-foreground" />
            <select
              aria-label="Active camera"
              value={v.cameraId ?? ""}
              onChange={(e) => e.target.value && ed().applyCamera(e.target.value)}
              className="size-full appearance-none bg-transparent pl-6 pr-6 outline-none"
            >
              {!v.cameraId && <option value="">Custom view</option>}
              {cams.map((c, i) => <option key={c.id} value={c.id} className="bg-popover">{c.name}{i < 9 ? `  (${i + 1})` : ""}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground" />
          </label>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <FieldLabel>Tilt</FieldLabel>
            <NumberField label="Tilt" prefix="X" value={v.tilt} min={0} max={85} suffix="°" onChange={(tilt) => ed().setPose({ tilt })} />
          </div>
          <div className="flex-1">
            <FieldLabel>Turn</FieldLabel>
            <NumberField label="Turn" prefix="Z" value={v.turn} min={-180} max={180} wrap suffix="°" onChange={(turn) => ed().setPose({ turn })} />
          </div>
        </div>
        <Seg<Projection> label="Projection" value={v.projection} onChange={(projection) => ed().setPose({ projection })} options={[{ id: "perspective", label: "Perspective" }, { id: "orthographic", label: "Orthographic" }]} />
        <div className="flex gap-2">
          <div className="flex-1">
            <FieldLabel>Field of view</FieldLabel>
            <NumberField label="Field of view" prefix={<Scan />} value={v.fov} min={10} max={90} suffix="°" className={cn(v.projection === "orthographic" && "opacity-50")} onChange={(fov) => ed().setPose({ fov })} />
          </div>
          <div className="flex-1">
            <FieldLabel>Distance</FieldLabel>
            <NumberField label="Distance" prefix={<MoveDiagonal />} value={v.distance} min={0.35} max={3} step={0.05} suffix="×" onChange={(distance) => ed().setPose({ distance })} />
          </div>
        </div>
      </Section>

      <Section title="Light & material">
        <div className="-mt-1 flex items-center gap-3">
          <LightDial angle={v.lightAngle} onChange={(lightAngle) => ed().set3D({ lightAngle })} />
          <div className="flex flex-1 flex-col gap-1.5">
            <NumberField label="Light angle" prefix={<Sun />} value={v.lightAngle} min={0} max={360} wrap suffix="°" onChange={(lightAngle) => ed().set3D({ lightAngle })} />
            <NumberField label="Light intensity" prefix={<SunDim />} value={v.lightIntensity} min={0} max={100} suffix="%" onChange={(lightIntensity) => ed().set3D({ lightIntensity })} />
          </div>
        </div>
        <div>
          <Seg<Material> label="Material" value={v.material} onChange={(material) => ed().set3D({ material })} options={[{ id: "matte", label: "Matte" }, { id: "glossy", label: "Glossy" }, { id: "metal", label: "Metal" }]} />
        </div>
      </Section>
    </>
  );
}

/** Drag the sun around the dial to set where the light comes from. */
function LightDial({ angle, onChange }: { angle: number; onChange: (deg: number) => void }) {
  const set = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const a = Math.atan2(-(e.clientY - r.top - r.height / 2), e.clientX - r.left - r.width / 2);
    onChange(Math.round((((a * 180) / Math.PI) % 360 + 360) % 360));
  };
  const rad = (angle * Math.PI) / 180;
  return (
    <div
      role="slider"
      aria-label="Light direction"
      aria-valuenow={angle}
      tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
      onPointerMove={(e) => e.buttons && set(e)}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") onChange((angle + 5) % 360); if (e.key === "ArrowRight") onChange((angle + 355) % 360); }}
      className="relative size-[52px] shrink-0 cursor-pointer touch-none rounded-full border border-border bg-[radial-gradient(circle_at_35%_35%,#ffffff26,#ffffff05)] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground" />
      <span
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-white bg-[#ffd36b]"
        style={{ left: `${50 + Math.cos(rad) * 32}%`, top: `${50 - Math.sin(rad) * 32}%` }}
      />
    </div>
  );
}
