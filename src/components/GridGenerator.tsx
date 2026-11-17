import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Dices, Hexagon, Minus, Plus, Sun, Pentagon, Rows3, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";
import { LAYER_INFO, generatePath, newGridDef, newLayer, randomLayers, type Layer, type LayerKind } from "@/lib/generator";
import { GRID_SPACE, registerCustomGrid } from "@/lib/templates";
import { loadRegions, type RegionSet } from "@/lib/regions";
import { useEditor } from "@/store/editor";
import { notify } from "@/store/notice";
import { cn } from "@/lib/utils";

const ICONS: Record<LayerKind, typeof Circle> = { lines: Rows3, lattice: Circle, rings: Sun, spokes: Plus, polygon: Pentagon, hexagons: Hexagon };
const MAX_LAYERS = 6;

const DEFAULT_LAYERS = (): Layer[] => [
  { ...newLayer("lines"), spacing: 40 } as Layer,
  { ...newLayer("lines"), angle: 90, spacing: 40 } as Layer,
  { ...newLayer("rings"), count: 3, inner: 40, outer: 120 } as Layer,
];

/** Stable short hash so identical layer stacks reuse the same preview build. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

export function GridGenerator({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: { name: string; layers: Layer[] } }) {
  const count = useEditor((s) => s.customGrids.length);
  const [name, setName] = useState("");
  const [layers, setLayers] = useState<Layer[]>(DEFAULT_LAYERS);

  useEffect(() => {
    if (!open) return;
    setName(initial ? `${initial.name} copy` : `Custom grid ${count + 1}`);
    setLayers(initial ? initial.layers.map((l) => ({ ...l })) : DEFAULT_LAYERS());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (id: string, patch: Partial<Layer>) => setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));
  const remove = (id: string) => setLayers((ls) => ls.filter((l) => l.id !== id));
  const add = (k: LayerKind) => setLayers((ls) => [...ls, newLayer(k)]);

  const save = () => {
    const def = newGridDef(name.trim() || `Custom grid ${count + 1}`, layers);
    useEditor.getState().addCustomGrid(def);
    notify(`Saved “${def.name}” to My grids`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(640px,92vh)] w-[min(940px,96vw)]" aria-describedby="generator-desc">
        <Preview layers={layers} />
        <div className="flex min-w-0 flex-1 flex-col border-l border-border">
          <div className="px-5 pb-3 pt-4">
            <DialogTitle>Grid generator</DialogTitle>
            <DialogDescription id="generator-desc" className="mt-0.5">Stack layers of lines and circles. Every closed area becomes a drawable shape.</DialogDescription>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Grid name"
              className="mt-4 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/20"
            />
          </div>

          <div className="scroll-area min-h-0 flex-1 px-5">
            {layers.length === 0 && (
              <p className="py-10 text-center text-[13px] text-muted-foreground">No layers yet — add one below, or roll the dice.</p>
            )}
            {layers.map((l, i) => (
              <LayerEditor key={l.id} layer={l} index={i} onChange={(p) => update(l.id, p)} onRemove={() => remove(l.id)} />
            ))}
            <div className="py-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={layers.length >= MAX_LAYERS}>
                    <Plus />
                    Add layer
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-64">
                  {(Object.keys(LAYER_INFO) as LayerKind[]).map((k) => {
                    const Icon = ICONS[k];
                    return (
                      <DropdownMenuItem key={k} onSelect={() => add(k)} className="items-start py-2">
                        <Icon className="mt-0.5" />
                        <div>
                          <div className="font-medium">{LAYER_INFO[k].label}</div>
                          <div className="text-[11px] text-muted-foreground">{LAYER_INFO[k].hint}</div>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border px-5 py-3">
            <Tip label="Random grid">
              <Button variant="outline" size="sm" onClick={() => setLayers(randomLayers())}>
                <Dices />
                Randomize
              </Button>
            </Tip>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={!layers.length}>Save grid</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- live preview ---------- */

const Preview = memo(function Preview({ layers }: { layers: Layer[] }) {
  const d = useMemo(() => generatePath(layers), [layers]);
  const [regions, setRegions] = useState<RegionSet | null>(null);
  const [state, setState] = useState<"building" | "ready" | "empty">("building");
  const req = useRef(0);

  // Build the drawable shapes shortly after edits settle; lines update instantly.
  useEffect(() => {
    const id = ++req.current;
    setState("building");
    const t = window.setTimeout(async () => {
      if (!layers.length) { setRegions(null); setState("empty"); return; }
      const draftId = `draft-${hash(JSON.stringify(layers.map(({ id: _id, ...rest }) => rest)))}`;
      registerCustomGrid({ id: draftId, name: "Draft", layers, createdAt: 0 });
      const set = await loadRegions(draftId, 16).catch(() => null);
      if (id === req.current && set) { setRegions(set); setState("ready"); }
    }, 140);
    return () => window.clearTimeout(t);
  }, [layers]);

  return (
    <div className="flex w-[46%] shrink-0 flex-col bg-background/60 p-6">
      <div className="relative aspect-square w-full">
        <svg viewBox={`0 0 ${GRID_SPACE} ${GRID_SPACE}`} className="absolute inset-0 size-full" aria-label="Grid preview">
          <defs><clipPath id="gen-clip"><rect width={GRID_SPACE} height={GRID_SPACE} /></clipPath></defs>
          <g clipPath="url(#gen-clip)">
            {regions?.paths.map((p, i) => (
              // Tint every shape so it's clear what will be fillable.
              <path key={i} d={p} fillRule="evenodd" fill="var(--brand)" fillOpacity={0.04 + ((i * 37) % 5) * 0.03} />
            ))}
            <path d={d} fill="none" stroke="var(--foreground)" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
          <rect width={GRID_SPACE} height={GRID_SPACE} fill="none" stroke="var(--foreground)" strokeOpacity={0.3} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <p className={cn("mt-4 text-center text-xs tabular-nums text-muted-foreground", state === "building" && "animate-pulse")}>
        {state === "empty" ? "Add a layer to start" : state === "building" ? "Finding shapes…" : `${regions?.count ?? 0} drawable shapes`}
      </p>
    </div>
  );
});

/* ---------- per-layer controls ---------- */

function LayerEditor({ layer: l, index, onChange, onRemove }: { layer: Layer; index: number; onChange: (p: Partial<Layer>) => void; onRemove: () => void }) {
  const Icon = ICONS[l.kind];
  return (
    <section className={cn("flex flex-col gap-2.5 py-4", index > 0 && "border-t border-border")}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-brand" />
        <h4 className="text-[13px] font-medium">{LAYER_INFO[l.kind].label}</h4>
        <Tip label="Remove layer">
          <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" onClick={onRemove} aria-label="Remove layer">
            <Trash2 className="size-3.5" />
          </Button>
        </Tip>
      </div>
      {l.kind === "lines" && (
        <>
          <Param label="Angle" value={l.angle} min={0} max={179} unit="°" onChange={(angle) => onChange({ angle })} />
          <Param label="Spacing" value={l.spacing} min={6} max={120} onChange={(spacing) => onChange({ spacing, offset: Math.min(l.offset, spacing) })} />
          <Param label="Offset" value={l.offset} min={0} max={l.spacing} onChange={(offset) => onChange({ offset })} />
        </>
      )}
      {l.kind === "lattice" && (
        <>
          <Param label="Spacing" value={l.spacing} min={16} max={120} onChange={(spacing) => onChange({ spacing, radius: Math.min(l.radius, Math.round(spacing * 1.5)) })} />
          <Param label="Radius" value={l.radius} min={4} max={Math.min(120, Math.round(l.spacing * 1.5))} onChange={(radius) => onChange({ radius })} />
          <div className="flex min-h-6 items-center justify-between">
            <span className="text-xs text-muted-foreground">Staggered rows</span>
            <Switch checked={l.stagger} onCheckedChange={(stagger) => onChange({ stagger })} aria-label="Staggered rows" />
          </div>
        </>
      )}
      {l.kind === "rings" && (
        <>
          <Param label="Count" value={l.count} min={1} max={12} onChange={(count) => onChange({ count })} />
          <Param label="Inner" value={l.inner} min={0} max={Math.max(0, l.outer - 4)} onChange={(inner) => onChange({ inner })} />
          <Param label="Outer" value={l.outer} min={20} max={170} onChange={(outer) => onChange({ outer, inner: Math.min(l.inner, outer - 4) })} />
        </>
      )}
      {l.kind === "spokes" && (
        <>
          <Param label="Count" value={l.count} min={2} max={48} onChange={(count) => onChange({ count })} />
          <Param label="Rotation" value={l.rotation} min={0} max={180} unit="°" onChange={(rotation) => onChange({ rotation })} />
        </>
      )}
      {l.kind === "polygon" && (
        <>
          <Param label="Sides" value={l.sides} min={3} max={12} onChange={(sides) => onChange({ sides })} />
          <Param label="Radius" value={l.radius} min={20} max={170} onChange={(radius) => onChange({ radius })} />
          <Param label="Nested" value={l.nested} min={1} max={6} onChange={(nested) => onChange({ nested })} />
          <Param label="Rotation" value={l.rotation} min={0} max={120} unit="°" onChange={(rotation) => onChange({ rotation })} />
        </>
      )}
      {l.kind === "hexagons" && <Param label="Size" value={l.size} min={8} max={80} onChange={(size) => onChange({ size })} />}
    </section>
  );
}

function Param({ label, value, min, max, unit = "", onChange }: { label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex min-h-6 items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Slider value={[value]} min={min} max={max} step={1} onValueChange={([v]) => onChange(v)} aria-label={label} />
      <div className="flex shrink-0 items-center">
        <button aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, value - 1))} className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"><Minus className="size-3" /></button>
        <span className="w-10 text-center text-xs tabular-nums">{value}{unit}</span>
        <button aria-label={`Increase ${label}`} onClick={() => onChange(Math.min(max, value + 1))} className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="size-3" /></button>
      </div>
    </div>
  );
}
