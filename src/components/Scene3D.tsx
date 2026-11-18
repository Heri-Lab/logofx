import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpFromLine, Minus, MousePointerClick, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Scene3DEngine, type MeshSpec, type SceneInput } from "@/lib/scene3d";
import { traceUnion, useRegions } from "@/lib/regions";
import { gridPathOf, hasPerspective, isIdentity, transformMatrix } from "@/lib/templates";
import { projectedGridPath } from "@/lib/project";
import { BUILTIN_CAMERAS, EMPTY_FILLS, editableLayer, layer3d, packFill, unpackFill, useEditor, useTransform, useView, type CameraPose, type View3D } from "@/store/editor";
import { commitFaceDepth, editShapes, faceAt, useFaceInfo } from "@/lib/faces";
import { notify } from "@/store/notice";
import { canvasApi } from "@/lib/canvas-api";
import { CanvasMenu } from "@/components/CanvasMenu";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Same set of shapes (faceAt lists them starting from whichever one was hit). */
const sameFace = (a: number[], b: number[]) => a.length === b.length && Math.min(...a) === Math.min(...b);
const poseOf = (v: View3D): CameraPose => ({ tilt: v.tilt, turn: v.turn, projection: v.projection, fov: v.fov, distance: v.distance });

/** The tilted canvas: extruded faces on the artboard, orbit and extrude tools, cameras. */
export default function Scene3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Scene3DEngine | null>(null);
  const view = useEditor((s) => s.view3d);
  const tool = useEditor((s) => s.tool);
  const meshes = useMeshes();
  const face = useFaceInfo();
  const [hoverIds, setHoverIds] = useState<{ key: string; ids: number[] } | null>(null);
  const hover = useHoverInfo(hoverIds);
  const input = useSceneInput(meshes.specs, tool === "extrude" && face?.d ? face : null, hover?.d ? hover : null);
  // Escape drops the picked face.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      const face = useView.getState().face;
      if (e.key === "Escape") useView.getState().setFace(null);
      // Delete removes the selected face (its shapes go back to empty), as one undo step.
      if ((e.key === "Delete" || e.key === "Backspace") && face) {
        const st = useEditor.getState();
        const v = st.fills[face.key]?.[face.ids[0]];
        if (v === undefined || !editableLayer(st.layers, unpackFill(v).layer)) return;
        e.preventDefault();
        editShapes(face.key, face.ids, () => null);
        useView.getState().setFace(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const e = new Scene3DEngine(canvasRef.current!, poseOf(useEditor.getState().view3d));
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => e.setSize(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    e.setSize(wrap.clientWidth, wrap.clientHeight);
    // The face controls follow their face every frame (camera moves, extrusion changes).
    e.onHover = (p) => {
      const el = hudRef.current;
      if (!el) return;
      el.style.visibility = p ? "visible" : "hidden";
      if (p) {
        const x = clamp(p.x, el.offsetWidth / 2 + 8, wrap.clientWidth - el.offsetWidth / 2 - 8);
        const y = clamp(p.y - 14, el.offsetHeight + 8, wrap.clientHeight);
        el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight}px)`;
      }
    };
    canvasApi.snapshot3D = () => e.snapshot();
    // While tilted, the toolbar zoom moves the camera instead of scaling the flat artboard.
    const flat = { zoomBy: canvasApi.zoomBy, fit: canvasApi.fit };
    canvasApi.zoomBy = (f) => {
      const st = useEditor.getState();
      st.setPose({ distance: +clamp(st.view3d.distance / f, 0.35, 3).toFixed(3) });
    };
    canvasApi.fit = () => useEditor.getState().setPose({ distance: 1 });
    setEngine(e);
    return () => {
      ro.disconnect();
      e.dispose();
      canvasApi.snapshot3D = async () => null;
      Object.assign(canvasApi, flat);
    };
  }, []);

  const pose = useMemo(() => poseOf(view), [view]);
  useEffect(() => { engine?.setPose(pose, drag.current?.kind === "orbit"); }, [engine, pose]);
  useEffect(() => { if (engine && input) engine.setInput(input); }, [engine, input]);

  /* ---------- picking ---------- */
  /** The face (connected shapes sharing a fill) under a client point, or null. */
  const faceUnder = (clientX: number, clientY: number) => {
    const rs = meshes.regions;
    if (!engine || !rs) return null;
    const r = canvasRef.current!.getBoundingClientRect();
    const hit = engine.pick(clientX - r.left, clientY - r.top);
    const id = hit ? rs.hit.find(hit.x, hit.y) : -1;
    const fills = useEditor.getState().fills[rs.key] ?? EMPTY_FILLS;
    if (id < 0 || fills[id] === undefined) return null;
    return { key: rs.key, ids: faceAt(rs, fills, id), value: fills[id] };
  };

  /* ---------- hover: the face under the pointer gets its own controls ---------- */
  const hoverRaf = useRef(0);
  const hideTimer = useRef(0);
  const overHud = useRef(false);
  const showHover = (f: { key: string; ids: number[] } | null) => {
    window.clearTimeout(hideTimer.current);
    if (f) {
      setHoverIds((cur) => (cur && cur.key === f.key && sameFace(cur.ids, f.ids) ? cur : { key: f.key, ids: f.ids }));
    } else {
      // A short grace period lets the pointer travel from the face onto its controls.
      hideTimer.current = window.setTimeout(() => !overHud.current && setHoverIds(null), 280);
    }
  };
  const trackHover = (clientX: number, clientY: number) => {
    cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => showHover(faceUnder(clientX, clientY)));
  };

  /* ---------- orbit, extrude and zoom ---------- */
  const drag = useRef<{ kind: "orbit"; x: number; y: number; tilt: number; turn: number } | { kind: "extrude"; y: number; key: string; ids: number[]; depth: number } | null>(null);
  const [dragging, setDragging] = useState<"orbit" | "extrude" | null>(null);

  /** Starts extruding a face; the drag ends as one undo step. */
  const startExtrude = (f: { key: string; ids: number[] }, clientY: number) => {
    const st = useEditor.getState();
    const v = st.fills[f.key]?.[f.ids[0]];
    if (v === undefined) return false;
    const u = unpackFill(v);
    const layer = st.layers.find((l) => l.id === u.layer) ?? st.layers[0];
    if (!editableLayer(st.layers, layer.id)) { notify(`“${layer.name}” is ${layer.locked ? "locked" : "hidden"}.`); return false; }
    useView.getState().setFace({ key: f.key, ids: f.ids });
    st.selectLayer(layer.id);
    st.beginStroke(f.key);
    drag.current = { kind: "extrude", y: clientY, key: f.key, ids: f.ids, depth: u.depth ?? layer3d(layer).extrude };
    setDragging("extrude");
    return true;
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return false;
    const st = useEditor.getState();
    if (d.kind === "orbit") {
      st.setPose({ turn: Math.round(d.turn - (e.clientX - d.x) * 0.4), tilt: Math.round(clamp(d.tilt + (e.clientY - d.y) * 0.35, 0, 85)) });
    } else {
      const step = e.shiftKey ? 4 : 1;
      st.setDepth(d.key, d.ids, Math.round(clamp(d.depth + (d.y - e.clientY) * 0.3, 0, 120) / step) * step);
    }
    return true;
  };
  const endDrag = () => {
    const d = drag.current;
    if (d?.kind === "extrude") useEditor.getState().endStroke(d.key);
    drag.current = null;
    setDragging(null);
  };
  const capture = (e: React.PointerEvent) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const st = useEditor.getState();
    const orbit = tool !== "extrude" || e.altKey || e.button === 1;
    if (!orbit) {
      const f = faceUnder(e.clientX, e.clientY);
      if (!f) { useView.getState().setFace(null); return; }
      if (!startExtrude(f, e.clientY)) return;
    } else {
      drag.current = { kind: "orbit", x: e.clientX, y: e.clientY, tilt: st.view3d.tilt, turn: st.view3d.turn };
      setDragging("orbit");
      setHoverIds(null);
    }
    capture(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (moveDrag(e)) return;
    trackHover(e.clientX, e.clientY);
  };

  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useEditor.getState();
      st.setPose({ distance: +clamp(st.view3d.distance * Math.exp(e.deltaY * 0.0015), 0.35, 3).toFixed(3) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 bg-background animate-in fade-in-0 duration-300">
      <CanvasMenu resolve={(x, y) => { const f = faceUnder(x, y); return f && { key: f.key, ids: f.ids }; }}>
      <canvas
        ref={canvasRef}
        className={cn("absolute inset-0 size-full touch-none", dragging === "orbit" ? "cursor-grabbing" : dragging === "extrude" || (tool === "extrude" && hover) ? "cursor-ns-resize" : hover ? "cursor-pointer" : "cursor-grab")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => !drag.current && showHover(null)}
      />
      </CanvasMenu>
      <div
        ref={hudRef}
        className="invisible absolute left-0 top-0"
        onPointerEnter={() => { overHud.current = true; window.clearTimeout(hideTimer.current); }}
        onPointerLeave={() => { overHud.current = false; if (!drag.current) showHover(null); }}
      >
        {hover && dragging !== "orbit" && (
          <FaceControls
            hover={hover}
            onExtrudeStart={(e) => { if (startExtrude(hover, e.clientY)) capture(e); }}
            onExtrudeMove={moveDrag}
            onExtrudeEnd={endDrag}
          />
        )}
      </div>
      <CameraCard engine={engine} meshes={input} />
      <ViewGizmo tilt={view.tilt} turn={view.turn} />
    </div>
  );
}

type HoverInfo = NonNullable<ReturnType<typeof useHoverInfo>>;

/** Layer, colour, depth and traced outline of the hovered face. */
function useHoverInfo(target: { key: string; ids: number[] } | null) {
  const fills = useEditor((s) => (target ? s.fills[target.key] ?? EMPTY_FILLS : EMPTY_FILLS));
  const layers = useEditor((s) => s.layers);
  const [outline, setOutline] = useState<{ ids: number[]; d: string } | null>(null);
  const valid = !!target && target.ids.every((id) => fills[id] !== undefined);
  useEffect(() => {
    if (!valid || !target) return;
    let alive = true;
    traceUnion(target.key, [target.ids]).then((r) => alive && setOutline({ ids: target.ids, d: r.paths[0] ?? "" }));
    return () => { alive = false; };
  }, [valid, target, fills]);
  return useMemo(() => {
    if (!valid || !target) return null;
    const f = unpackFill(fills[target.ids[0]]);
    const layer = layers.find((l) => l.id === f.layer) ?? layers[0];
    const layerDepth = layer3d(layer).extrude;
    return { key: target.key, ids: target.ids, layer, color: f.color, own: f.depth !== undefined, depth: f.depth ?? layerDepth, layerDepth, d: outline?.ids === target.ids ? outline.d : null };
  }, [valid, target, fills, layers, outline]);
}

/** Floating controls for the face under the pointer: colour, depth (drag, step or type) and reset. */
function FaceControls({ hover, onExtrudeStart, onExtrudeMove, onExtrudeEnd }: {
  hover: HoverInfo;
  onExtrudeStart: (e: React.PointerEvent) => void;
  onExtrudeMove: (e: React.PointerEvent) => void;
  onExtrudeEnd: () => void;
}) {
  const locked = !editableLayer(useEditor.getState().layers, hover.layer.id);
  const setDepth = (d: number | null) => commitFaceDepth(hover.key, hover.ids, d === null ? null : clamp(d, 0, 120));
  const recolor = (c: string) => {
    const ed = useEditor.getState();
    ed.beginStroke(hover.key);
    ed.strokeApply(hover.key, hover.ids, packFill(hover.layer.id, c, hover.own ? hover.depth : undefined));
    ed.endStroke(hover.key);
  };
  const btn = "grid size-6 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5";
  return (
    <div className="flex h-9 animate-in items-center gap-0.5 rounded-xl border border-border bg-card px-1.5 shadow-lg shadow-black/40 fade-in-0 zoom-in-95 duration-150">
      <Tip label={`${hover.layer.name} · ${hover.ids.length} shape${hover.ids.length === 1 ? "" : "s"}`}>
        <label className={cn("relative mx-1 size-4 shrink-0 cursor-pointer overflow-hidden rounded-[4px] ring-1 ring-inset ring-white/25", locked && "pointer-events-none opacity-40")} style={{ background: hover.color }}>
          <input type="color" aria-label="Face colour" value={hover.color.slice(0, 7)} onChange={(e) => recolor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      </Tip>
      <span className="mx-1 h-4 w-px bg-border" />
      <Tip label="Drag to extrude · Shift for steps of 4">
        <button
          aria-label="Drag to extrude"
          disabled={locked}
          onPointerDown={onExtrudeStart}
          onPointerMove={onExtrudeMove}
          onPointerUp={onExtrudeEnd}
          onPointerCancel={onExtrudeEnd}
          className="flex h-6 cursor-ns-resize touch-none items-center gap-1 rounded-[5px] bg-primary/15 px-1.5 text-[11px] font-semibold text-[#7cc4ff] hover:bg-primary/25 disabled:opacity-40"
        >
          <ArrowUpFromLine className="size-3" />
          <span className="tabular-nums">{hover.depth} px</span>
        </button>
      </Tip>
      <Tip label="Lower"><button aria-label="Lower face" disabled={locked || hover.depth <= 0} className={btn} onClick={() => setDepth(hover.depth - 4)}><Minus /></button></Tip>
      <Tip label="Raise"><button aria-label="Raise face" disabled={locked || hover.depth >= 120} className={btn} onClick={() => setDepth(hover.depth + 4)}><Plus /></button></Tip>
      {hover.own && (
        <>
          <span className="mx-1 h-4 w-px bg-border" />
          <Tip label={`Back to layer depth (${hover.layerDepth} px)`}>
            <button aria-label="Reset face depth" disabled={locked} className={btn} onClick={() => setDepth(null)}><RotateCcw /></button>
          </Tip>
        </>
      )}
      <Tip label="Select face">
        <button aria-label="Select face" className={btn} onClick={() => { useView.getState().setFace({ key: hover.key, ids: hover.ids }); useEditor.getState().selectLayer(hover.layer.id); useEditor.getState().setTool("extrude"); }}>
          <MousePointerClick />
        </button>
      </Tip>
    </div>
  );
}

/** Traced outlines per layer and colour, with each layer's extrusion. */
function useMeshes() {
  const templateId = useEditor((s) => s.templateId);
  const density = useEditor((s) => s.density);
  const transform = useTransform();
  const { regions } = useRegions(templateId, density, transform);
  const fills = useEditor((s) => (regions ? s.fills[regions.key] ?? EMPTY_FILLS : EMPTY_FILLS));
  const layers = useEditor((s) => s.layers);
  const [traced, setTraced] = useState<{ values: string[]; paths: string[] } | null>(null);

  useEffect(() => {
    if (!regions) return;
    const by = new Map<string, number[]>();
    for (const [id, v] of Object.entries(fills)) (by.get(v) ?? by.set(v, []).get(v)!).push(+id);
    const values = [...by.keys()];
    if (!values.length) { setTraced({ values: [], paths: [] }); return; }
    let alive = true;
    const t = window.setTimeout(async () => {
      const res = await traceUnion(regions.key, values.map((v) => by.get(v)!));
      if (alive) setTraced({ values, paths: res.paths });
    }, 80);
    return () => { alive = false; window.clearTimeout(t); };
  }, [regions, fills]);

  const specs = useMemo<MeshSpec[] | null>(() => {
    if (!traced) return null;
    const out: MeshSpec[] = [];
    traced.values.forEach((v, i) => {
      // One mesh per fill value: shapes extruded on their own carry their depth in the value.
      const { layer: lid, color, depth } = unpackFill(v);
      const layer = layers.find((l) => l.id === lid) ?? layers[0];
      if (!layer.visible || !traced.paths[i]) return;
      const l3 = layer3d(layer);
      out.push({ layerId: layer.id, color, d: traced.paths[i], ...l3, extrude: depth ?? l3.extrude, opacity: layer.opacity });
    });
    return out;
  }, [traced, layers]);
  return { specs, regions };
}

function useSceneInput(meshes: MeshSpec[] | null, face: { d: string | null; depth: number } | null, hover: { d: string | null; depth: number } | null): SceneInput | null {
  const s = useEditor((st) => st.view3d);
  const templateId = useEditor((st) => st.templateId);
  const density = useEditor((st) => st.density);
  const lineColor = useEditor((st) => st.lineColor);
  const lineOpacity = useEditor((st) => st.lineOpacity);
  const preview = useEditor((st) => st.preview);
  const transform = useTransform();
  const faceD = face?.d ?? null, faceDepth = face?.depth ?? 0;
  const faceInput = useMemo(() => (faceD ? { d: faceD, depth: faceDepth } : null), [faceD, faceDepth]);
  const hoverD = hover?.d ?? null, hoverDepth = hover?.depth ?? 0;
  const hoverInput = useMemo(() => (hoverD ? { d: hoverD, depth: hoverDepth } : null), [hoverD, hoverDepth]);
  const grid = useMemo(() => {
    if (preview) return null;
    if (hasPerspective(transform)) return { d: projectedGridPath(templateId, density, transform) };
    return { d: gridPathOf(templateId, density, transform), matrix: isIdentity(transform) ? undefined : transformMatrix(transform) };
  }, [preview, templateId, density, transform]);
  return useMemo(
    () =>
      meshes && {
        meshes,
        grid,
        lineColor,
        lineOpacity,
        material: s.material,
        lightAngle: s.lightAngle,
        lightIntensity: s.lightIntensity,
        face: faceInput,
        hover: hoverInput,
      },
    [meshes, grid, lineColor, lineOpacity, s.material, s.lightAngle, s.lightIntensity, faceInput, hoverInput],
  );
}

/** Saved points of view, each previewed from its own angle. 1–9 switch between them. */
function CameraCard({ engine, meshes }: { engine: Scene3DEngine | null; meshes: SceneInput | null }) {
  const saved = useEditor((s) => s.cameras);
  const activeId = useEditor((s) => s.view3d.cameraId);
  const cams = useMemo(() => [...BUILTIN_CAMERAS, ...saved], [saved]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!engine || !meshes) return;
    const t = window.setTimeout(() => setThumbs(Object.fromEntries(cams.map((c) => [c.id, engine.thumbnail(c, 120, 76)]))), 250);
    return () => window.clearTimeout(t);
  }, [engine, meshes, cams]);
  const ed = useEditor.getState;
  return (
    <div className="scroll-area absolute left-4 top-4 flex max-h-[calc(100%-120px)] w-36 flex-col gap-2.5 rounded-xl border border-border bg-card p-3 shadow-lg shadow-black/35">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold">Cameras</h3>
        <Tip label="Save current view">
          <button aria-label="Save camera" onClick={() => ed().saveCamera()} className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /></button>
        </Tip>
      </div>
      {cams.map((c, i) => {
        const on = c.id === activeId;
        const custom = i >= BUILTIN_CAMERAS.length;
        return (
          <div key={c.id} className="group relative">
            <button onClick={() => ed().applyCamera(c.id)} aria-pressed={on} className="flex w-full flex-col gap-1 text-left outline-none">
              <span className={cn("block h-[76px] w-full overflow-hidden rounded-md bg-background ring-inset", on ? "ring-2 ring-primary" : "ring-1 ring-white/10 group-hover:ring-white/25")}>
                {thumbs[c.id] && <img src={thumbs[c.id]} alt="" className="size-full object-cover" />}
              </span>
              <span className="flex w-full items-center justify-between text-[11px]">
                <span className={on ? "font-semibold" : "text-muted-foreground"}>{c.name}</span>
                {i < 9 && <span className="text-[10px] text-muted-foreground">{i + 1}</span>}
              </span>
            </button>
            {custom && (
              <button aria-label={`Delete ${c.name}`} onClick={() => ed().deleteCamera(c.id)} className="absolute right-1 top-1 grid size-5 place-items-center rounded bg-card/90 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100">
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** X/Y/Z axes as seen from the current pose; the button returns to the active (or default) camera. */
function ViewGizmo({ tilt, turn }: { tilt: number; turn: number }) {
  const t = (tilt * Math.PI) / 180, r = (turn * Math.PI) / 180;
  // World axis → screen: inverse of the camera's turntable rotation (turn about Z, then tilt about X).
  const proj = (x: number, y: number, z: number) => {
    const x1 = x * Math.cos(r) + y * Math.sin(r), y1 = -x * Math.sin(r) + y * Math.cos(r);
    const y2 = y1 * Math.cos(t) + z * Math.sin(t), z2 = -y1 * Math.sin(t) + z * Math.cos(t);
    return { x: 36 + x1 * 24, y: 36 - y2 * 24, z: z2 };
  };
  const axes = [
    { l: "X", c: "#f24822", p: proj(1, 0, 0) },
    { l: "Y", c: "#14ae5c", p: proj(0, 1, 0) },
    { l: "Z", c: "#0d99ff", p: proj(0, 0, 1) },
  ].sort((a, b) => a.p.z - b.p.z);
  const reset = () => {
    const s = useEditor.getState();
    s.applyCamera(s.view3d.cameraId ?? "persp");
  };
  return (
    <div className="absolute right-4 top-4 flex flex-col items-center gap-1.5">
      <svg viewBox="0 0 72 72" className="size-24 rounded-full border border-border bg-card/80 p-3 shadow-lg shadow-black/35" aria-hidden>
        {axes.map(({ l, c, p }) => (
          <g key={l}>
            <line x1={36} y1={36} x2={p.x} y2={p.y} stroke={c} strokeWidth={2} />
            <circle cx={p.x} cy={p.y} r={7} fill={c} />
            <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">{l}</text>
          </g>
        ))}
        <circle cx={36} cy={36} r={2.5} fill="#fff" />
      </svg>
      <button onClick={reset} className="flex h-6 items-center gap-1 rounded-md border border-border bg-card/80 px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground">
        <RotateCcw className="size-3" />
        Reset view
      </button>
    </div>
  );
}
