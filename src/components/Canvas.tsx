import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, PanelRight, X } from "lucide-react";
import { traceUnion, useRegions, type RegionSet } from "@/lib/regions";
import { GRID_SPACE, gridPathOf, hasPerspective, isIdentity, transformMatrix, type GridTransform } from "@/lib/templates";
import { projectedGridPath } from "@/lib/project";
import { carryFills } from "@/lib/transition";
import { EMPTY_FILLS, activeFill, editableLayer, sameFill, useEditor, useTransform, useView, type Fills } from "@/store/editor";
import { stackByLayer } from "@/lib/layers";
import { faceAt } from "@/lib/faces";
import { CanvasMenu, type MenuTarget } from "@/components/CanvasMenu";
import { notify } from "@/store/notice";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Toolbar } from "@/components/Toolbar";
import { cn } from "@/lib/utils";
import { canvasApi } from "@/lib/canvas-api";
import { attachTileCanvas, drawTiles, setTileArt } from "@/lib/tiles";

// three.js only loads the first time the canvas is tilted into 3D.
const Scene3D = lazy(() => import("@/components/Scene3D"));

/** Artboard size in CSS px at 100% zoom. */
const BASE = 640;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

type View = { x: number; y: number; s: number };


export function Canvas() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const guidesRef = useRef<HTMLDivElement>(null);
  const templateId = useEditor((s) => s.templateId);
  const density = useEditor((s) => s.density);
  const tool = useEditor((s) => s.tool);
  const preview = useEditor((s) => s.preview);
  const hintDismissed = useEditor((s) => s.hintDismissed);
  const is3D = useEditor((s) => s.view3d.enabled);
  const transform = useTransform();
  const { regions, loading } = useRegions(templateId, density, transform, carryFills);
  const regionsRef = useRef<RegionSet | null>(regions);
  regionsRef.current = regions;
  // Edits always target the shapes currently on screen (a transform may still be building).
  const activeKey = () => regionsRef.current?.key ?? "";

  const view = useRef<View>({ x: 0, y: 0, s: 1 });
  const userMoved = useRef(false);
  const beforeTiles = useRef<{ view: View; moved: boolean } | null>(null);
  const frame = useRef(0);
  const anim = useRef(0);
  const idle = useRef(0);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState<"pan" | "paint" | null>(null);

  /* ---------- viewport transform (no React renders per frame) ---------- */
  const flush = useCallback(() => {
    frame.current = 0;
    const st = stageRef.current;
    if (!st) return;
    const { x, y, s } = view.current;
    st.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    // Guides extend the artboard's edges across the viewport, so they always frame a square
    // and follow every pan/zoom in the same frame as the grid.
    // Tile preview lives in screen space and follows the same transform in the same frame.
    drawTiles(x, y, s, BASE); // no-op while the tile preview is off
    const g = guidesRef.current;
    if (g) {
      const [l, r, t, b] = g.children as unknown as HTMLElement[];
      const size = BASE * s;
      l.style.transform = `translate3d(${x - 0.5}px, 0, 0)`;
      r.style.transform = `translate3d(${x + size - 0.5}px, 0, 0)`;
      t.style.transform = `translate3d(0, ${y - 0.5}px, 0)`;
      b.style.transform = `translate3d(0, ${y + size - 0.5}px, 0)`;
    }
    if (Math.abs(useView.getState().zoom - s) > 0.0005) useView.getState().setZoom(s);
  }, []);
  const schedule = useCallback(() => {
    const st = stageRef.current;
    if (st) {
      // Promote to its own layer while moving; drop it when idle so vectors re-rasterise crisply.
      st.style.willChange = "transform";
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(() => { if (stageRef.current) stageRef.current.style.willChange = "auto"; }, 160);
    }
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  }, [flush]);

  const fitView = useCallback((): View => {
    const vp = viewportRef.current!;
    const w = vp.clientWidth, h = vp.clientHeight;
    const top = 92, bottom = 104;
    const s = clamp(Math.min((w - 96) / BASE, (h - top - bottom) / BASE), MIN_ZOOM, 1.5);
    return { s, x: (w - BASE * s) / 2, y: top + (h - top - bottom - BASE * s) / 2 };
  }, []);

  const animateTo = useCallback(
    (target: View, duration = 240, onDone?: () => void) => {
      cancelAnimationFrame(anim.current);
      const from = { ...view.current };
      const t0 = performance.now();
      const step = (now: number) => {
        const k = easeOut(Math.min(1, (now - t0) / duration));
        view.current = { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k, s: from.s + (target.s - from.s) * k };
        schedule();
        if (k < 1) anim.current = requestAnimationFrame(step);
        else onDone?.();
      };
      anim.current = requestAnimationFrame(step);
    },
    [schedule],
  );

  const zoomAround = useCallback((target: number, px: number, py: number): View => {
    const { x, y, s } = view.current;
    const ns = clamp(target, MIN_ZOOM, MAX_ZOOM);
    return { s: ns, x: px - (px - x) * (ns / s), y: py - (py - y) * (ns / s) };
  }, []);

  useLayoutEffect(() => {
    view.current = fitView();
    flush();
    canvasApi.fit = () => { userMoved.current = false; animateTo(fitView()); };
    canvasApi.revealTiles = () => {
      const target = fitView().s / 3;
      if (view.current.s <= target * 1.05) return;
      beforeTiles.current = { view: { ...view.current }, moved: userMoved.current };
      userMoved.current = true;
      // Keep the artboard centred while zooming out.
      const cx = view.current.x + (BASE * view.current.s) / 2, cy = view.current.y + (BASE * view.current.s) / 2;
      animateTo({ s: target, x: cx - (BASE * target) / 2, y: cy - (BASE * target) / 2 }, 420);
    };
    canvasApi.hideTiles = () => {
      const prev = beforeTiles.current;
      beforeTiles.current = null;
      // Zoom back to where the reveal started (or the fitted view) with the same easing and
      // duration, and only then fade the tiles out.
      userMoved.current = prev?.moved ?? false;
      animateTo(prev?.moved ? prev.view : fitView(), 420, () => {
        if (useEditor.getState().tilePreview) useEditor.getState().toggleTilePreview();
      });
    };
    canvasApi.zoomBy = (f) => {
      const vp = viewportRef.current!;
      userMoved.current = true;
      animateTo(zoomAround(view.current.s * f, vp.clientWidth / 2, vp.clientHeight / 2), 200);
    };
    const vp = viewportRef.current!;
    let last = { w: vp.clientWidth, h: vp.clientHeight };
    const ro = new ResizeObserver(() => {
      const w = vp.clientWidth, h = vp.clientHeight;
      if (!userMoved.current) view.current = fitView();
      else view.current = { ...view.current, x: view.current.x + (w - last.w) / 2, y: view.current.y + (h - last.h) / 2 };
      last = { w, h };
      schedule();
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [animateTo, fitView, flush, schedule, zoomAround]);

  /* ---------- wheel: pinch / ctrl-wheel zooms, two-finger scroll pans ---------- */
  useEffect(() => {
    const vp = viewportRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      userMoved.current = true;
      const r = vp.getBoundingClientRect();
      const scale = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp((-e.deltaY * scale) / (e.ctrlKey && !e.metaKey ? 110 : 300));
        view.current = zoomAround(view.current.s * f, e.clientX - r.left, e.clientY - r.top);
      } else {
        view.current = { ...view.current, x: view.current.x - e.deltaX * scale, y: view.current.y - e.deltaY * scale };
      }
      schedule();
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [schedule, zoomAround]);

  /* ---------- space-to-pan ---------- */
  useEffect(() => {
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !editable(e.target)) { e.preventDefault(); setSpaceHeld(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceHeld(false); };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  /* ---------- pointer: paint, erase, pan, pinch ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
    | { kind: "paint"; color: string | null; lx: number; ly: number }
    | { kind: "pinch"; d: number; mx: number; my: number; view: View }
    | null
  >(null);

  const toStage = (clientX: number, clientY: number) => {
    const r = viewportRef.current!.getBoundingClientRect();
    const { x, y, s } = view.current;
    return { lx: (clientX - r.left - x) / s, ly: (clientY - r.top - y) / s };
  };
  const regionAt = (lx: number, ly: number) => {
    const rs = regionsRef.current;
    if (!rs || lx < 0 || ly < 0 || lx >= BASE || ly >= BASE) return -1;
    return rs.hit.find((lx / BASE) * rs.res, (ly / BASE) * rs.res);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const vp = viewportRef.current!;
    vp.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelAnimationFrame(anim.current);

    if (pointers.current.size === 2) {
      // Second finger: abandon any stroke and start pinch-zoom.
      if (gesture.current?.kind === "paint") useEditor.getState().endStroke(activeKey());
      const [a, b] = [...pointers.current.values()];
      const r = vp.getBoundingClientRect();
      gesture.current = { kind: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, view: { ...view.current } };
      setDragging("pan");
      return;
    }
    const ed = useEditor.getState();
    if (tool === "pan" || spaceHeld || e.button === 1) {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.current.x, oy: view.current.y };
      setDragging("pan");
      return;
    }
    const { lx, ly } = toStage(e.clientX, e.clientY);
    const id = regionAt(lx, ly);
    if (id < 0 || !regionsRef.current) return;
    const layer = ed.layers.find((l) => l.id === ed.activeLayer);
    if (tool !== "erase" && layer && !editableLayer(ed.layers, layer.id)) {
      notify(`“${layer.name}” is ${layer.locked ? "locked" : "hidden"}. Pick another layer to paint.`);
      return;
    }
    const key = activeKey();
    const cur = ed.fills[key] ?? EMPTY_FILLS;
    const value = activeFill(ed);
    const color = tool === "erase" || sameFill(cur[id], value) ? null : value;
    ed.beginStroke(key);
    ed.strokeApply(key, [id], color);
    gesture.current = { kind: "paint", color, lx, ly };
    setDragging("paint");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g?.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const r = viewportRef.current!.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      const ns = clamp(g.view.s * (d / g.d), MIN_ZOOM, MAX_ZOOM);
      view.current = { s: ns, x: mx - (g.mx - g.view.x) * (ns / g.view.s), y: my - (g.my - g.view.y) * (ns / g.view.s) };
      userMoved.current = true;
      schedule();
      return;
    }
    if (g?.kind === "pan") {
      view.current = { ...view.current, x: g.ox + e.clientX - g.sx, y: g.oy + e.clientY - g.sy };
      userMoved.current = true;
      schedule();
      return;
    }
    if (g?.kind === "paint") {
      // Walk every coalesced sample and interpolate so fast strokes never skip shapes.
      const events = (e.nativeEvent.getCoalescedEvents?.() ?? []).length ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
      const ids = new Set<number>();
      let { lx, ly } = g;
      for (const ev of events) {
        const p = toStage(ev.clientX, ev.clientY);
        const dist = Math.hypot(p.lx - lx, p.ly - ly);
        const steps = Math.max(1, Math.ceil(dist / 2));
        for (let i = 1; i <= steps; i++) {
          const id = regionAt(lx + ((p.lx - lx) * i) / steps, ly + ((p.ly - ly) * i) / steps);
          if (id >= 0) ids.add(id);
        }
        lx = p.lx;
        ly = p.ly;
      }
      g.lx = lx;
      g.ly = ly;
      if (ids.size) useEditor.getState().strokeApply(activeKey(), [...ids], g.color);
      useView.getState().setHover(regionAt(lx, ly));
      return;
    }
    if (!useEditor.getState().hoverPreview || tool === "pan" || spaceHeld) return;
    const { lx, ly } = toStage(e.clientX, e.clientY);
    const id = regionAt(lx, ly);
    if (id !== useView.getState().hover) useView.getState().setHover(id);
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "paint") useEditor.getState().endStroke(activeKey());
    if (pointers.current.size === 0 || g?.kind !== "pinch") {
      gesture.current = null;
      setDragging(null);
    }
  };

  /** Right-click: the face under the pointer (connected shapes with one fill), or the empty shape. */
  const menuTarget = (clientX: number, clientY: number): MenuTarget => {
    const rs = regionsRef.current;
    const { lx, ly } = toStage(clientX, clientY);
    const id = regionAt(lx, ly);
    if (!rs || id < 0) return null;
    const fills = useEditor.getState().fills[rs.key] ?? EMPTY_FILLS;
    return { key: rs.key, ids: fills[id] === undefined ? [id] : faceAt(rs, fills, id) };
  };

  const cursor =
    dragging === "pan" ? "cursor-grabbing" : tool === "pan" || spaceHeld ? "cursor-grab" : regions ? "cursor-crosshair" : "cursor-progress";

  return (
    <main className="relative min-w-0 flex-1 overflow-hidden bg-background">
      <TilePreview />
      <StageGuides ref={guidesRef} />
      <CanvasMenu resolve={menuTarget}>
      <div
        ref={viewportRef}
        className={cn("absolute inset-0 touch-none select-none", cursor)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => !gesture.current && useView.getState().setHover(-1)}
        onDoubleClick={(e) => { if (tool === "pan") { e.preventDefault(); canvasApi.fit(); } }}
      >
        <div ref={stageRef} className="absolute left-0 top-0 origin-top-left" style={{ width: BASE, height: BASE }}>
          {regions && <Artwork regions={regions} />}
          {!preview && <GridLines templateId={templateId} density={density} transform={transform} />}
          {loading && <div className="pointer-events-none absolute inset-0 animate-shimmer rounded-sm" />}
        </div>
      </div>
      </CanvasMenu>

      {is3D && (
        <Suspense fallback={<div className="absolute inset-0 animate-shimmer" />}>
          <Scene3D />
        </Suspense>
      )}

      {!hintDismissed && !is3D && (
        <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center">
          <div className="pointer-events-auto flex h-10 animate-rise items-center gap-3 rounded-xl border border-border bg-card pl-4 pr-1.5 text-[13px] shadow-lg shadow-black/35">
            Your grid defines the shapes. Click a shape to fill it, drag to fill many.
            <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => useEditor.getState().dismissHint()} aria-label="Dismiss">
              <X />
            </Button>
          </div>
        </div>
      )}

      <CornerButtons />
      <Toolbar />
    </main>
  );
}

/* ---------- layers ---------- */

const Artwork = memo(function Artwork({ regions }: { regions: RegionSet }) {
  const fills = useEditor((s) => s.fills[regions.key] ?? EMPTY_FILLS);
  return (
    <svg viewBox={`0 0 ${regions.res} ${regions.res}`} className="absolute inset-0 size-full overflow-visible" shapeRendering="geometricPrecision">
      <FillLayer regions={regions} fills={fills} />
      <GhostLayer regions={regions} />
      <HoverLayer regions={regions} fills={fills} />
    </svg>
  );
});

/** [packed fill value, path] — the value carries both the layer and the colour. */
type Group = readonly [string, string];

const FillLayer = memo(function FillLayer({ regions, fills }: { regions: RegionSet; fills: Fills }) {
  // Live: concatenated per-region paths (instant). Idle: per-fill union traced in the
  // worker, which removes every internal seam and matches the exported SVG exactly.
  const layers = useEditor((s) => s.layers);
  const [union, setUnion] = useState<{ fills: Fills; key: string; groups: Group[] } | null>(null);
  const live = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const [id, v] of Object.entries(fills)) {
      const d = regions.paths[+id];
      if (!d) continue;
      let arr = by.get(v);
      if (!arr) by.set(v, (arr = []));
      arr.push(d);
    }
    return [...by.entries()].map(([v, ds]) => [v, ds.join("")] as const);
  }, [regions, fills]);

  useEffect(() => {
    const entries = Object.entries(fills);
    if (!entries.length) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      const by = new Map<string, number[]>();
      for (const [id, v] of entries) (by.get(v) ?? by.set(v, []).get(v)!).push(+id);
      const values = [...by.keys()];
      const res = await traceUnion(regions.key, values.map((v) => by.get(v)!));
      if (alive) setUnion({ fills, key: regions.key, groups: res.paths.map((d, i) => [values[i], d] as const) });
    }, 140);
    return () => { alive = false; window.clearTimeout(t); };
  }, [regions.key, fills]);

  const settled = union && union.fills === fills && union.key === regions.key;
  const groups = settled ? union.groups : live;
  const stack = useMemo(() => stackByLayer(groups, layers), [groups, layers]);
  useEffect(() => { setTileArt(stack.flatMap(({ groups: g }) => g)); }, [stack]);
  return (
    <g>
      {stack.map(({ layer, groups: g }) => (
        <g key={layer.id} opacity={layer.opacity / 100} style={layer.blend === "normal" ? undefined : { mixBlendMode: layer.blend }}>
          {g.map(([color, d]) => (
            <path
              key={color}
              d={d}
              fillRule="evenodd"
              fill={color}
              // While live, a same-colour hairline hides anti-aliasing seams between neighbours.
              stroke={settled ? "none" : color}
              strokeWidth={settled ? 0 : 1}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      ))}
    </g>
  );
});

function HoverLayer({ regions, fills }: { regions: RegionSet; fills: Fills }) {
  const hover = useView((s) => s.hover);
  const tool = useEditor((s) => s.tool);
  const ink = useEditor((s) => s.ink);
  const value = useEditor(activeFill);
  const enabled = useEditor((s) => s.hoverPreview);
  if (!enabled || hover < 0 || tool === "pan") return null;
  const d = regions.paths[hover];
  if (!d) return null;
  const erasing = tool === "erase" || sameFill(fills[hover], value);
  return erasing ? (
    <path d={d} fillRule="evenodd" fill="#000" fillOpacity={fills[hover] ? 0.28 : 0} stroke="#fff" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
  ) : (
    <path d={d} fillRule="evenodd" fill={ink} fillOpacity={0.22} stroke={ink} strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" />
  );
}

function GhostLayer({ regions }: { regions: RegionSet }) {
  const ghost = useView((s) => s.ghost);
  const d = useMemo(() => (ghost && ghost.key === regions.key ? ghost.ids.map((i) => regions.paths[i]).join("") : ""), [ghost, regions]);
  if (!d) return null;
  return <path d={d} fillRule="evenodd" className="animate-in fade-in-0 duration-200" fill="var(--brand)" fillOpacity={0.4} stroke="var(--brand)" strokeOpacity={0.8} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
}

const GridLines = memo(function GridLines({ templateId, density, transform }: { templateId: string; density: number; transform: GridTransform }) {
  const color = useEditor((s) => s.lineColor);
  const opacity = useEditor((s) => s.lineOpacity);
  // Lines update instantly with the transform; shapes follow as soon as the worker rebuilds them.
  // Similarity transforms are applied by SVG (exact arcs); perspective is projected on the CPU.
  const projected = hasPerspective(transform);
  const d = useMemo(
    () => (projected ? projectedGridPath(templateId, density, transform) : gridPathOf(templateId, density, transform)),
    [projected, templateId, density, transform],
  );
  const m = projected || isIdentity(transform) ? undefined : `matrix(${transformMatrix(transform).join(" ")})`;
  return (
    <svg viewBox={`0 0 ${GRID_SPACE} ${GRID_SPACE}`} className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <defs>
        <clipPath id="artboard-clip"><rect width={GRID_SPACE} height={GRID_SPACE} /></clipPath>
      </defs>
      <g fill="none" stroke={color} strokeOpacity={Math.max(0.04, opacity / 100)} strokeWidth={1}>
        <g clipPath="url(#artboard-clip)">
          <path d={d} transform={m} vectorEffect="non-scaling-stroke" />
        </g>
        <rect width={GRID_SPACE} height={GRID_SPACE} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
});

/** Repeats the artwork around the artboard to preview it as a pattern (see lib/tiles). */
function TilePreview() {
  const on = useEditor((s) => s.tilePreview);
  return (
    <canvas
      ref={(c) => attachTileCanvas(on ? c : null)}
      className={cn("pointer-events-none absolute inset-0 size-full transition-opacity duration-300", on ? "opacity-100" : "opacity-0")}
      aria-hidden
    />
  );
}

/** Faint construction guides on the artboard's edges, positioned by `flush`. */
function StageGuides({ ref }: { ref: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-y-0 left-0 w-px bg-white/[0.06] will-change-transform" />
      <div className="absolute inset-y-0 left-0 w-px bg-white/[0.06] will-change-transform" />
      <div className="absolute inset-x-0 top-0 h-px bg-white/[0.06] will-change-transform" />
      <div className="absolute inset-x-0 top-0 h-px bg-white/[0.06] will-change-transform" />
    </div>
  );
}

function CornerButtons() {
  const showAI = useEditor((s) => s.showAI);
  const showLibrary = useEditor((s) => s.showLibrary);
  return (
    <>
      <Tip label={showAI ? "Hide layers & assistant" : "Show layers & assistant"} side="right">
        <Button
          variant="outline"
          size="icon"
          className={cn("absolute bottom-5 left-4 size-10 rounded-xl border-border bg-card shadow-lg shadow-black/35 hover:bg-muted", showAI && "text-foreground")}
          onClick={() => useEditor.getState().toggleAI()}
          aria-label="Toggle left panel"
        >
          <PanelLeft />
        </Button>
      </Tip>
      <Tip label={showLibrary ? "Hide design panel" : "Show design panel"} side="left">
        <Button variant="outline" size="icon" className="absolute bottom-5 right-4 size-10 rounded-xl border-border bg-card shadow-lg shadow-black/35 hover:bg-muted" onClick={() => useEditor.getState().toggleLibrary()} aria-label="Toggle design panel">
          <PanelRight />
        </Button>
      </Tip>
    </>
  );
}
