import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IDENTITY, baseKeyOf, baseOfKey, gridKeyOf, registerCustomGrid, unregisterCustomGrid, type Density, type GridTransform } from "@/lib/templates";
import type { CustomGridDef } from "@/lib/generator";

export type Fills = Record<number, string>;
export type Tool = "paint" | "pan" | "erase";

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
  hintDismissed: boolean;
  fills: Record<string, Fills>;
  history: Record<string, History>;
  /** Transform per base grid (template + density), so each grid remembers its own. */
  transforms: Record<string, GridTransform>;
  /** Grids made with the generator. */
  customGrids: CustomGridDef[];
  addCustomGrid: (def: CustomGridDef) => void;
  deleteCustomGrid: (id: string) => void;

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

      setTemplate: (templateId) => set({ templateId }),
      setDensity: (density) => set({ density }),
      setSettings: (p) => set(p),
      resetSettings: () => set({ ...DEFAULT_SETTINGS, density: 16 }),
      setInk: (ink) => set({ ink, tool: get().tool === "erase" ? "paint" : get().tool }),
      setTool: (tool) => set({ tool }),
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
            if (color ? cur[id] === color : cur[id] === undefined) continue;
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
  setZoom: (z: number) => void;
  setHover: (h: number) => void;
  setGhost: (g: ViewState["ghost"]) => void;
}
export const useView = create<ViewState>()((set) => ({
  zoom: 1,
  hover: -1,
  ghost: null,
  setZoom: (zoom) => set({ zoom }),
  setHover: (hover) => set({ hover }),
  setGhost: (ghost) => set({ ghost }),
}));
