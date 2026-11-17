import { useEffect, useRef, useState } from "react";
import { conceptKey, type Concept } from "./shapes";
import { GRID_SPACE, IDENTITY, baseOfKey, gridKeyOf, gridPathOf, specFromKey, type GridTransform } from "./templates";
import { HitIndex } from "@/geometry/hit";
import type { Loop } from "@/geometry/seg";

export interface RegionSet {
  key: string;
  /** Coordinate space of `paths` (the template's 240×240 space). */
  res: number;
  count: number;
  /** Exact SVG path per drawable shape (true lines and arcs), in artboard space. */
  paths: string[];
  /** Vector point → shape lookup. */
  hit: HitIndex;
  engine: "vector" | "raster";
}

export type WorkerRequest =
  | { type: "build"; id: number; key: string; path: string; transform: GridTransform }
  | { type: "concept"; id: number; key: string; concept: Concept }
  | { type: "union"; id: number; key: string; groups: number[][] }
  | { type: "remap"; id: number; fromKey: string; toKey: string; fills: Record<string, string> };

export type WorkerResponse =
  | { type: "built"; id: number; key: string; engine: "vector" | "raster"; ms: number; paths: string[]; faces: { loops: Loop[]; bbox: [number, number, number, number] }[] }
  | { type: "concept"; id: number; ids: number[] }
  | { type: "union"; id: number; paths: string[] }
  | { type: "remap"; id: number; fills: Record<number, string> }
  | { type: "error"; id: number; message: string };

const worker = new Worker(new URL("../workers/regions.worker.ts", import.meta.url), { type: "module" });
let seq = 0;
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.type === "error") p.reject(new Error(e.data.message));
  else p.resolve(e.data as never);
};
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
function call<T extends WorkerResponse>(req: DistributiveOmit<WorkerRequest, "id">): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    worker.postMessage({ ...req, id });
  });
}

/* ---------- region sets (LRU, mirrored in the worker) ---------- */
type Spec = { templateId: string; density: number; t: GridTransform };
const specs = new Map<string, Spec>();
const regionCache = new Map<string, Promise<RegionSet | null>>();
const ready = new Map<string, RegionSet>();
const LIMIT = 48;

const build = (key: string, s: Spec) =>
  call<Extract<WorkerResponse, { type: "built" }>>({ type: "build", key, path: gridPathOf(s.templateId, s.density, s.t), transform: s.t });

/*
 * Build queue: one build at a time, newest request first. When a newer transform of the
 * same grid is requested, older pending ones are dropped (resolved with null) — dragging a
 * slider jumps straight to the latest state instead of replaying every intermediate step.
 */
type Job = { key: string; spec: Spec; resolve: (s: RegionSet | null) => void; reject: (e: unknown) => void };
const queue: Job[] = [];
let running = false;
function schedule(job: Job) {
  const base = baseOfKey(job.key);
  for (let i = queue.length - 1; i >= 0; i--)
    if (baseOfKey(queue[i].key) === base) { queue[i].resolve(null); queue.splice(i, 1); }
  queue.push(job);
  pump();
}
function pump() {
  if (running || !queue.length) return;
  const job = queue.pop()!;
  running = true;
  build(job.key, job.spec)
    .then((r) => {
      const set: RegionSet = { key: job.key, res: GRID_SPACE, count: r.paths.length, paths: r.paths, hit: new HitIndex(r.faces, GRID_SPACE), engine: r.engine };
      if (import.meta.env.DEV && r.ms > 60) console.debug(`[logofx] ${job.key}: ${set.count} shapes via ${r.engine} in ${r.ms.toFixed(1)}ms`);
      ready.set(job.key, set);
      job.resolve(set);
    }, job.reject)
    .finally(() => { running = false; pump(); });
}

/** Resolves with the grid's shapes, or null if a newer transform of the same grid superseded it. */
export function loadRegions(templateId: string, density: number, t: GridTransform = IDENTITY): Promise<RegionSet | null> {
  const key = gridKeyOf(templateId, density, t);
  let p = regionCache.get(key);
  if (p) {
    regionCache.delete(key);
    regionCache.set(key, p);
    return p;
  }
  const spec = { templateId, density, t };
  specs.set(key, spec);
  p = new Promise<RegionSet | null>((resolve, reject) => schedule({ key, spec, resolve, reject })).then((set) => {
    if (!set) regionCache.delete(key); // superseded: allow a later rebuild
    return set;
  });
  regionCache.set(key, p);
  while (regionCache.size > LIMIT) {
    const old = regionCache.keys().next().value!;
    regionCache.delete(old);
    ready.delete(old);
  }
  return p;
}

export const peekRegions = (key: string) => ready.get(key) ?? null;

/** If the worker doesn't have a grid (evicted, or from a previous session), rebuild it and retry. */
async function withGrid<T>(keys: string[], run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!String(err).includes("not built")) throw err;
    await Promise.all(keys.map((k) => build(k, specs.get(k) ?? specFromKey(k))));
    return run();
  }
}

/**
 * Latest ready region set for the requested grid. The previous set stays on screen while
 * the next builds; `beforeSwitch` runs first so dependent state (fills) can move atomically.
 */
export function useRegions(
  templateId: string,
  density: number,
  t: GridTransform = IDENTITY,
  beforeSwitch?: (prev: RegionSet | null, next: RegionSet) => Promise<void> | void,
) {
  const key = gridKeyOf(templateId, density, t);
  const [set, setSet] = useState<RegionSet | null>(() => peekRegions(key));
  const shown = useRef(set);
  shown.current = set;
  const hook = useRef(beforeSwitch);
  hook.current = beforeSwitch;
  useEffect(() => {
    let live = true;
    loadRegions(templateId, density, t).then(async (s) => {
      const prev = shown.current;
      if (!live || !s) return;
      if (prev?.key !== s.key && hook.current) await hook.current(prev, s);
      if (live) setSet(s);
    });
    return () => { live = false; };
    // `t` is captured by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { regions: set, loading: !set || set.key !== key };
}

/* ---------- worker queries ---------- */

const conceptCache = new Map<string, Promise<number[]>>();
export function conceptRegions(key: string, concept: Concept): Promise<number[]> {
  const k = `${key}#${conceptKey(concept)}`;
  let p = conceptCache.get(k);
  if (!p) {
    p = withGrid([key], () => call<Extract<WorkerResponse, { type: "concept" }>>({ type: "concept", key, concept })).then((r) => r.ids);
    p.catch(() => conceptCache.delete(k));
    conceptCache.set(k, p);
    if (conceptCache.size > 300) conceptCache.delete(conceptCache.keys().next().value!);
  }
  return p;
}

export function useConceptRegions(key: string | undefined, concept: Concept) {
  const [ids, setIds] = useState<number[] | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    setIds(null);
    conceptRegions(key, concept).then((r) => live && setIds(r), () => {});
    return () => { live = false; };
  }, [key, concept]);
  return ids;
}

export function traceUnion(key: string, groups: number[][]) {
  return withGrid([key], () => call<Extract<WorkerResponse, { type: "union" }>>({ type: "union", key, groups }));
}

/** Carries a drawing from one transform of a grid to another. */
export async function remapFills(fromKey: string, toKey: string, fills: Record<string, string>) {
  const r = await withGrid([fromKey, toKey], () => call<Extract<WorkerResponse, { type: "remap" }>>({ type: "remap", fromKey, toKey, fills }));
  return r.fills;
}
