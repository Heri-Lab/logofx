import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IDENTITY, baseKeyOf, baseOfKey, gridKeyOf, registerCustomGrid, unregisterCustomGrid, type Density, type GridTransform } from "@/lib/templates";
import type { CustomGridDef } from "@/lib/generator";

/** Shape id → packed fill (`layerId|#color`, see `packFill`). */
export type Fills = Record<number, string>;
export type Tool = "paint" | "pan" | "erase" | "orbit" | "extrude";
/** Tools that only make sense on the tilted 3D canvas. */
export const TOOLS_3D: Tool[] = ["orbit", "extrude"];
/** Left panel: what is in the drawing. The right panel is a single Design column. */
export type PanelTab = "layers" | "grids" | "assistant";
export type Blend = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
export const BLENDS: Blend[] = ["normal", "multiply", "screen", "overlay", "darken", "lighten"];

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0–100 */
  opacity: number;
  blend: Blend;
  /** 3D: extrusion depth and bevel, in artboard units (the 240-unit grid space). */
  extrude?: number;
  bevel?: number;
  profile?: BevelProfile;
  /** 3D side colour; null/undefined uses the face colour (lighting shades it). */
  sideColor?: string | null;
}

export type BevelProfile = "chamfer" | "round" | "step";
export const LAYER_3D = { extrude: 12, bevel: 2, profile: "round" as BevelProfile };
export const layer3d = (l: Layer) => ({
  extrude: l.extrude ?? LAYER_3D.extrude,
  bevel: l.bevel ?? LAYER_3D.bevel,
  profile: l.profile ?? LAYER_3D.profile,
  sideColor: l.sideColor ?? null,
});

export type Projection = "perspective" | "orthographic";
export type Material = "matte" | "glossy" | "metal";
/** A saved point of view on the tilted canvas. */
export interface Camera3D {
  id: string;
  name: string;
  /** Degrees the board leans back from facing the viewer (0 = flat front view). */
  tilt: number;
  /** Degrees the board turns around its own centre. */
  turn: number;
  projection: Projection;
  fov: number;
  /** Multiplier on the fitted camera distance. */
  distance: number;
}
export type CameraPose = Omit<Camera3D, "id" | "name">;
export interface View3D extends CameraPose {
  enabled: boolean;
  cameraId: string | null;
  lightAngle: number;
  lightIntensity: number;
  material: Material;
}
export const BUILTIN_CAMERAS: Camera3D[] = [
  { id: "front", name: "Front", tilt: 0, turn: 0, projection: "orthographic", fov: 35, distance: 1 },
  { id: "iso", name: "Isometric", tilt: 55, turn: -45, projection: "orthographic", fov: 35, distance: 1 },
  { id: "persp", name: "Perspective", tilt: 42, turn: -30, projection: "perspective", fov: 35, distance: 1 },
  { id: "low", name: "Low angle", tilt: 68, turn: 25, projection: "perspective", fov: 45, distance: 0.9 },
];
const DEFAULT_VIEW3D: View3D = {
  ...BUILTIN_CAMERAS[2],
  enabled: false,
  cameraId: "persp",
  lightAngle: 135,
  lightIntensity: 80,
  material: "glossy",
};
const poseOf = (c: CameraPose): CameraPose => ({ tilt: c.tilt, turn: c.turn, projection: c.projection, fov: c.fov, distance: c.distance });

/**
 * Each shape belongs to exactly one layer. The layer is packed into the fill value so every
 * fills-based path (history, remapping across transforms, concepts) carries it untouched.
 * Values saved before layers existed have no prefix and belong to the base layer.
 * A third part, when present, is the shape's own 3D extrusion (`layerId|#color|depth`);
 * without it the shape uses its layer's default depth.
 */
export const BASE_LAYER = "base";
export const packFill = (layer: string, color: string, depth?: number) =>
  depth === undefined ? `${layer}|${color}` : `${layer}|${color}|${depth}`;
/** Same layer and colour, whatever the 3D depth (painting over a raised shape keeps it raised). */
export const sameFill = (a: string | undefined, b: string) => {
  if (a === undefined) return false;
  const x = unpackFill(a), y = unpackFill(b);
  return x.layer === y.layer && x.color === y.color;
};
export const unpackFill = (v: string): { layer: string; color: string; depth?: number } => {
  const [a, b, c] = v.split("|");
  if (b === undefined) return { layer: BASE_LAYER, color: a };
  return c === undefined ? { layer: a, color: b } : { layer: a, color: b, depth: +c };
};
const newLayer = (id: string, name: string): Layer => ({ id, name, visible: true, locked: false, opacity: 100, blend: "normal" });

export const INKS = ["#f9fbfb", "#00c950", "#f5b041", "#7c9cff", "#ff6b6b", "#0b0e0f"];
export const LINE_COLORS = ["#ffffff", "#00c950", "#9ca8ab", "#f5b041", "#7c9cff"];

const EMPTY: Fills = Object.freeze({}) as Fills;
const HISTORY_LIMIT = 100;

interface History { past: Fills[]; future: Fills[] }

interface EditorState {
  templateId: string;
  density: Density;
  lineOpacity: number;
  lineColor: string;
  hoverPreview: boolean;
  guidesOnExport: boolean;
  ink: string;
  tool: Tool;
  preview: boolean;
  /** Repeat the artwork around the artboard to judge it as a pattern. */
  tilePreview: boolean;
  showAI: boolean;
  showLibrary: boolean;
  panelTab: PanelTab;
  setPanelTab: (t: PanelTab) => void;
  /** Design panel sections the user folded away. */
  collapsed: Record<string, boolean>;
  toggleSection: (id: string) => void;
  hintDismissed: boolean;
  fills: Record<string, Fills>;
  history: Record<string, History>;
  /** Transform per base grid (template + density), so each grid remembers its own. */
  transforms: Record<string, GridTransform>;
  /** Grids made with the generator. */
  customGrids: CustomGridDef[];
  addCustomGrid: (def: CustomGridDef) => void;
  deleteCustomGrid: (id: string) => void;
  /** Bottom to top: the last layer draws in front. */
  layers: Layer[];
  activeLayer: string;
  addLayer: () => void;
  selectLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Omit<Layer, "id">>) => void;
  moveLayer: (id: string, toIndex: number) => void;
  /** Removes the layer and its shapes on every grid. */
  deleteLayer: (id: string) => void;
  /** Moves the layer's shapes into the layer below it, then removes it. */
  mergeDown: (id: string) => void;
  /** Recolours every shape of the layer on the given grid, as one undoable step. */
  recolorLayer: (key: string, id: string, color: string) => void;
  /**
   * Sets the 3D extrusion of individual shapes (null = back to the layer default). Like
   * `strokeApply` it records no history: wrap it in `beginStroke`/`endStroke`.
   */
  setDepth: (key: string, ids: number[], depth: number | null) => void;

  view3d: View3D;
  /** User-saved cameras, after the built-in ones. */
  cameras: Camera3D[];
  set3D: (patch: Partial<View3D>) => void;
  /** Changing the pose by hand detaches from the active camera. */
  setPose: (patch: Partial<CameraPose>) => void;
  applyCamera: (id: string) => void;
  saveCamera: () => void;
  deleteCamera: (id: string) => void;
  reset3D: () => void;

  setTemplate: (id: string) => void;
  setDensity: (d: Density) => void;
  setSettings: (p: Partial<Pick<EditorState, "lineOpacity" | "lineColor" | "hoverPreview" | "guidesOnExport">>) => void;
  resetSettings: () => void;
  setInk: (c: string) => void;
  setTool: (t: Tool) => void;
  togglePreview: () => void;
  toggleTilePreview: () => void;
  toggleAI: () => void;
  toggleLibrary: () => void;
  dismissHint: () => void;

  setTransform: (patch: Partial<GridTransform>) => void;
  resetTransform: () => void;
  /** Move a drawing to another key (used when the grid is transformed). */
  moveFills: (from: string, to: string, fills: Fills) => void;

  /** Replace a grid's fills as one undoable step. */
  commit: (key: string, next: Fills) => void;
  /** Live stroke: mutate without history, then `endStroke` records one step. */
  beginStroke: (key: string) => void;
  strokeApply: (key: string, ids: number[], color: string | null) => void;
  endStroke: (key: string) => void;
  undo: (key: string) => void;
  redo: (key: string) => void;
}

const DEFAULT_SETTINGS = { lineOpacity: 12, lineColor: "#ffffff", hoverPreview: true, guidesOnExport: false };

export const editableLayer = (layers: Layer[], id: string) => {
  const l = layers.find((x) => x.id === id);
  return !l || (l.visible && !l.locked);
};

/** Applies `f` to every fill on every grid; returning null drops the shape. */
function mapAllFills(all: Record<string, Fills>, f: (v: string) => string | null) {
  const out: Record<string, Fills> = {};
  for (const [key, fills] of Object.entries(all)) {
    const next: Fills = {};
    for (const [id, v] of Object.entries(fills)) {
      const r = f(v);
      if (r !== null) next[+id] = r;
    }
    out[key] = next;
  }
  return out;
}
let strokeSnapshot: Fills | null = null;

const pushPast = (h: History | undefined, prev: Fills): History => ({
  past: [...(h?.past ?? []), prev].slice(-HISTORY_LIMIT),
  future: [],
});

export const useEditor = create<EditorState>()(
  persist(
    (set, get) => ({
      templateId: "square",
      density: 16,
      ...DEFAULT_SETTINGS,
      ink: INKS[0],
      tool: "paint",
      preview: false,
      tilePreview: false,
      showAI: true,
      showLibrary: true,
      panelTab: "layers",
      setPanelTab: (panelTab) => set({ panelTab, showAI: true }),
      // Grid set-up is done once per logo, so it starts folded.
      collapsed: { grid: true, transform: true },
      toggleSection: (id) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
      hintDismissed: false,
      fills: {},
      history: {},
      transforms: {},
      customGrids: [],
      addCustomGrid: (def) => {
        registerCustomGrid(def);
        set((s) => ({ customGrids: [def, ...s.customGrids], templateId: def.id }));
      },
      deleteCustomGrid: (id) =>
        set((s) => {
          unregisterCustomGrid(id);
          const keep = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => baseOfKey(k) !== id));
          return {
            customGrids: s.customGrids.filter((g) => g.id !== id),
            fills: keep(s.fills),
            history: keep(s.history),
            transforms: keep(s.transforms),
            templateId: s.templateId === id ? "square" : s.templateId,
          };
        }),

      layers: [newLayer(BASE_LAYER, "Layer 1")],
      activeLayer: BASE_LAYER,
      addLayer: () =>
        set((s) => {
          const n = s.layers.reduce((m, l) => Math.max(m, +(/^Layer (\d+)$/.exec(l.name)?.[1] ?? 0)), 0) + 1;
          const layer = newLayer(`l${Date.now().toString(36)}`, `Layer ${n}`);
          const at = s.layers.findIndex((l) => l.id === s.activeLayer) + 1;
          return { layers: [...s.layers.slice(0, at), layer, ...s.layers.slice(at)], activeLayer: layer.id };
        }),
      selectLayer: (activeLayer) => set({ activeLayer }),
      updateLayer: (id, patch) => set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
      moveLayer: (id, toIndex) =>
        set((s) => {
          const from = s.layers.findIndex((l) => l.id === id);
          if (from < 0 || toIndex === from) return s;
          const layers = [...s.layers];
          const [l] = layers.splice(from, 1);
          layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, l);
          return { layers };
        }),
      deleteLayer: (id) =>
        set((s) => {
          if (s.layers.length <= 1) return s;
          const i = s.layers.findIndex((l) => l.id === id);
          const layers = s.layers.filter((l) => l.id !== id);
          const fills = mapAllFills(s.fills, (v) => (unpackFill(v).layer === id ? null : v));
          return { layers, fills, history: {}, activeLayer: s.activeLayer === id ? layers[Math.max(0, i - 1)].id : s.activeLayer };
        }),
      mergeDown: (id) =>
        set((s) => {
          const i = s.layers.findIndex((l) => l.id === id);
          if (i <= 0) return s;
          const below = s.layers[i - 1].id;
          const fills = mapAllFills(s.fills, (v) => {
            const f = unpackFill(v);
            return f.layer === id ? packFill(below, f.color, f.depth) : v;
          });
          return { layers: s.layers.filter((l) => l.id !== id), fills, history: {}, activeLayer: below };
        }),
      recolorLayer: (key, id, color) => {
        const cur = get().fills[key] ?? EMPTY;
        const next: Fills = {};
        for (const [shape, v] of Object.entries(cur)) {
          const f = unpackFill(v);
          next[+shape] = f.layer === id ? packFill(id, color, f.depth) : v;
        }
        get().commit(key, next);
      },
      setDepth: (key, ids, depth) =>
        set((s) => {
          const cur = s.fills[key] ?? EMPTY;
          const next = { ...cur };
          for (const id of ids) {
            const v = cur[id];
            if (v === undefined) continue;
            const f = unpackFill(v);
            next[id] = packFill(f.layer, f.color, depth ?? undefined);
          }
          return { fills: { ...s.fills, [key]: next } };
        }),

      view3d: DEFAULT_VIEW3D,
      cameras: [],
      set3D: (patch) =>
        set((s) => {
          const view3d = { ...s.view3d, ...patch };
          // Keep the tool in step with the mode: 3D tools only exist on the tilted canvas.
          const tool = view3d.enabled ? (TOOLS_3D.includes(s.tool) ? s.tool : "orbit") : TOOLS_3D.includes(s.tool) ? "paint" : s.tool;
          return { view3d, tool };
        }),
      setPose: (patch) => set((s) => ({ view3d: { ...s.view3d, ...patch, cameraId: null } })),
      applyCamera: (id) =>
        set((s) => {
          const cam = [...BUILTIN_CAMERAS, ...s.cameras].find((c) => c.id === id);
          return cam ? { view3d: { ...s.view3d, ...poseOf(cam), cameraId: id, enabled: true } } : s;
        }),
      saveCamera: () =>
        set((s) => {
          const cam: Camera3D = { id: `c${Date.now().toString(36)}`, name: `Camera ${s.cameras.length + 1}`, ...poseOf(s.view3d) };
          return { cameras: [...s.cameras, cam], view3d: { ...s.view3d, cameraId: cam.id } };
        }),
      deleteCamera: (id) =>
        set((s) => ({ cameras: s.cameras.filter((c) => c.id !== id), view3d: s.view3d.cameraId === id ? { ...s.view3d, cameraId: null } : s.view3d })),
      reset3D: () =>
        set((s) => ({
          view3d: { ...DEFAULT_VIEW3D, enabled: s.view3d.enabled },
          layers: s.layers.map(({ extrude: _e, bevel: _b, profile: _p, sideColor: _c, ...l }) => l),
        })),

      setTemplate: (templateId) => set({ templateId }),
      setDensity: (density) => set({ density }),
      setSettings: (p) => set(p),
      resetSettings: () => set({ ...DEFAULT_SETTINGS, density: 16 }),
      setInk: (ink) => set({ ink, tool: get().tool === "erase" ? "paint" : get().tool }),
      // 3D tools tilt the canvas into 3D; painting needs the flat canvas, so it leaves 3D.
      setTool: (tool) =>
        set((s) => ({
          tool,
          view3d: TOOLS_3D.includes(tool) ? { ...s.view3d, enabled: true } : tool === "pan" ? s.view3d : { ...s.view3d, enabled: false },
        })),
      togglePreview: () => set((s) => ({ preview: !s.preview })),
      toggleTilePreview: () => set((s) => ({ tilePreview: !s.tilePreview })),
      toggleAI: () => set((s) => ({ showAI: !s.showAI })),
      toggleLibrary: () => set((s) => ({ showLibrary: !s.showLibrary })),
      dismissHint: () => set({ hintDismissed: true }),

      setTransform: (patch) =>
        set((s) => {
          const base = baseKeyOf(s.templateId, s.density);
          const next = { ...(s.transforms[base] ?? IDENTITY), ...patch };
          return { transforms: { ...s.transforms, [base]: next } };
        }),
      resetTransform: () =>
        set((s) => {
          const { [baseKeyOf(s.templateId, s.density)]: _drop, ...rest } = s.transforms;
          return { transforms: rest };
        }),
      moveFills: (from, to, fills) =>
        set((s) => {
          const { [from]: _old, ...rest } = s.fills;
          const { [from]: _oh, ...hist } = s.history;
          return { fills: { ...rest, [to]: fills }, history: { ...hist, [to]: { past: [], future: [] } } };
        }),

      commit: (key, next) =>
        set((s) => ({
          fills: { ...s.fills, [key]: next },
          history: { ...s.history, [key]: pushPast(s.history[key], s.fills[key] ?? EMPTY) },
        })),

      beginStroke: (key) => { strokeSnapshot = get().fills[key] ?? EMPTY; },
      strokeApply: (key, ids, color) =>
        set((s) => {
          const cur = s.fills[key] ?? EMPTY;
          let next: Fills | null = null;
          for (const id of ids) {
            if (color ? sameFill(cur[id], color) : cur[id] === undefined) continue;
            // Shapes on hidden or locked layers are protected.
            if (cur[id] !== undefined && !editableLayer(s.layers, unpackFill(cur[id]).layer)) continue;
            next ??= { ...cur };
            if (color) next[id] = color;
            else delete next[id];
          }
          return next ? { fills: { ...s.fills, [key]: next } } : s;
        }),
      endStroke: (key) => {
        const snap = strokeSnapshot;
        strokeSnapshot = null;
        if (!snap || snap === get().fills[key]) return;
        set((s) => ({ history: { ...s.history, [key]: pushPast(s.history[key], snap) } }));
      },
      undo: (key) =>
        set((s) => {
          const h = s.history[key];
          if (!h?.past.length) return s;
          const prev = h.past[h.past.length - 1];
          return {
            fills: { ...s.fills, [key]: prev },
            history: { ...s.history, [key]: { past: h.past.slice(0, -1), future: [s.fills[key] ?? EMPTY, ...h.future] } },
          };
        }),
      redo: (key) =>
        set((s) => {
          const h = s.history[key];
          if (!h?.future.length) return s;
          return {
            fills: { ...s.fills, [key]: h.future[0] },
            history: { ...s.history, [key]: { past: [...h.past, s.fills[key] ?? EMPTY], future: h.future.slice(1) } },
          };
        }),
    }),
    {
      name: "logofx.editor.v2", // v2: shape ids come from the exact vector engine
      partialize: ({ history: _h, preview: _p, ...rest }) =>
        Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== "function")) as Partial<EditorState>,
    },
  ),
);

// Saved generator grids must exist before anything asks for their geometry.
useEditor.getState().customGrids.forEach(registerCustomGrid);
useEditor.persist.onFinishHydration((s) => s.customGrids.forEach(registerCustomGrid));

export const EMPTY_FILLS = EMPTY;
/** The fill value new paint gets: the current ink on the active layer. */
export const activeFill = (s: Pick<EditorState, "activeLayer" | "ink">) => packFill(s.activeLayer, s.ink);
export const transformOf = (s: Pick<EditorState, "templateId" | "density" | "transforms">) =>
  s.transforms[baseKeyOf(s.templateId, s.density)] ?? IDENTITY;
export const useTransform = () => useEditor(transformOf);
export const currentGridKey = (s: Pick<EditorState, "templateId" | "density" | "transforms">) => gridKeyOf(s.templateId, s.density, transformOf(s));
export const useGridKey = () => useEditor(currentGridKey);
export const useHistoryState = (key: string) =>
  useEditor((s) => {
    const h = s.history[key];
    return `${h?.past.length ? 1 : 0}${h?.future.length ? 1 : 0}`;
  });

/** Ephemeral UI state that changes at pointer/frame rate; kept out of the persisted store. */
interface ViewState {
  zoom: number;
  hover: number;
  ghost: { key: string; ids: number[] } | null;
  /** 3D: the face picked with the Extrude tool (connected shapes that share a fill). */
  face: { key: string; ids: number[] } | null;
  setZoom: (z: number) => void;
  setHover: (h: number) => void;
  setGhost: (g: ViewState["ghost"]) => void;
  setFace: (f: ViewState["face"]) => void;
}
export const useView = create<ViewState>()((set) => ({
  zoom: 1,
  hover: -1,
  ghost: null,
  face: null,
  setZoom: (zoom) => set({ zoom }),
  setHover: (hover) => set({ hover }),
  setGhost: (ghost) => set({ ghost }),
  setFace: (face) => set({ face }),
}));
