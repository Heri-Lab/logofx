/// <reference lib="webworker" />
import { Arrangement } from "@/geometry/arrangement";
import { HitIndex, loopsBBox } from "@/geometry/hit";
import { insideLoops, loopToPath, segsToPath, type FaceGeom, type Loop } from "@/geometry/seg";
import { apply, inv, mul } from "@/geometry/mat3";
import { segsForPath } from "@/lib/project";
import { traceGroups } from "@/lib/trace";
import { SHAPES, type Concept } from "@/lib/shapes";
import { GRID_SPACE, homography, type GridTransform } from "@/lib/templates";
import type { WorkerRequest, WorkerResponse } from "@/lib/regions";

/**
 * Turns a grid into its drawable shapes.
 *
 * Primary: exact vector arrangement — faces bounded by the grid's true lines and
 * arcs. Fallback: if that ever fails validation, rasterise + flood-fill + trace.
 */
type Entry = (
  | { engine: "vector"; arr: Arrangement; faces: FaceGeom[]; hit: HitIndex }
  | { engine: "raster"; labels: Int32Array; faces: FaceGeom[]; hit: HitIndex }
) & { t: GridTransform; anchors?: Float64Array };

/** Small LRU: transform drags create many grids; reading an entry keeps it alive. */
const cache = new Map<string, Entry>();
const getEntry = (key: string) => {
  const e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); }
  return e;
};
const putEntry = (key: string, e: Entry) => {
  cache.set(key, e);
  while (cache.size > 48) cache.delete(cache.keys().next().value!);
};

function buildVector(path: string, t: GridTransform): Entry {
  const arr = new Arrangement(segsForPath(path, t), GRID_SPACE);
  return { engine: "vector", arr, faces: arr.faces, hit: new HitIndex(arr.faces, GRID_SPACE), t };
}

/** A point strictly inside each face (cached), used to carry fills across transforms. */
function anchors(e: Entry): Float64Array {
  if (e.anchors) return e.anchors;
  const out = new Float64Array(e.faces.length * 2).fill(NaN);
  e.faces.forEach((f, i) => {
    const [x0, y0, x1, y1] = f.bbox;
    let best = -1, bx = 0, by = 0;
    // Pick the sample furthest from the bbox edge among those inside the face.
    for (let n = 5; n <= 17 && best < 0; n += 6)
      for (let j = 1; j < n; j++)
        for (let k = 1; k < n; k++) {
          const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * j) / n;
          if (!insideLoops(f.loops, x, y)) continue;
          const score = Math.min(k, n - k) * Math.min(j, n - j);
          if (score > best) { best = score; bx = x; by = y; }
        }
    if (best >= 0) { out[2 * i] = bx; out[2 * i + 1] = by; }
  });
  return (e.anchors = out);
}


/** Re-express a drawing made on one transform of a grid on another transform of the same grid. */
function remap(from: Entry, to: Entry, fills: Record<string, string>) {
  const A = anchors(to);
  // artboard(to) → template space → artboard(from), all as one homography.
  const M = mul(homography(from.t), inv(homography(to.t)));
  const out: Record<number, string> = {};
  for (let i = 0; i < to.faces.length; i++) {
    const px = A[2 * i], py = A[2 * i + 1];
    if (Number.isNaN(px)) continue;
    const [qx, qy] = apply(M, px, py);
    const src = from.hit.find(qx, qy);
    const color = src >= 0 ? fills[src] : undefined;
    if (color) out[i] = color;
  }
  return out;
}

/* ---------- raster fallback ---------- */
const RES = 1280;
const K = GRID_SPACE / RES;

const polysToLoops = (polys: number[][]): Loop[] =>
  polys.map((flat) => {
    const loop: Loop = [];
    const n = flat.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      loop.push({ k: 0, x0: flat[2 * i] * K, y0: flat[2 * i + 1] * K, x1: flat[2 * j] * K, y1: flat[2 * j + 1] * K });
    }
    return loop;
  });

function buildRaster(path: string, t: GridTransform): Entry {
  const T = RES * RES;
  const ctx = new OffscreenCanvas(RES, RES).getContext("2d", { willReadFrequently: true })!;
  ctx.scale(RES / GRID_SPACE, RES / GRID_SPACE);
  ctx.lineWidth = (2 * GRID_SPACE) / RES;
  ctx.stroke(new Path2D(segsToPath(segsForPath(path, t))));
  const alpha = ctx.getImageData(0, 0, RES, RES).data;
  const raw = new Int32Array(T).fill(-1), line = new Uint8Array(T), stack = new Int32Array(T);
  for (let i = 0; i < T; i++) line[i] = alpha[i * 4 + 3] > 60 ? 1 : 0;
  const areas: number[] = [];
  let count = 0;
  for (let i = 0; i < T; i++) {
    if (line[i] || raw[i] !== -1) continue;
    let sp = 0, area = 0;
    stack[sp++] = i; raw[i] = count;
    while (sp) {
      const p = stack[--sp]; area++;
      const x = p % RES;
      for (const q of [x > 0 ? p - 1 : -1, x < RES - 1 ? p + 1 : -1, p - RES, p + RES])
        if (q >= 0 && q < T && !line[q] && raw[q] === -1) { raw[q] = count; stack[sp++] = q; }
    }
    areas.push(area); count++;
  }
  const remap = new Int32Array(count).fill(-1);
  let n = 0;
  for (let l = 0; l < count; l++) if (areas[l] >= 80) remap[l] = n++;
  const labels = new Int32Array(T);
  for (let i = 0; i < T; i++) labels[i] = raw[i] < 0 ? -1 : remap[raw[i]];
  let qh = 0, qt = 0;
  for (let i = 0; i < T; i++) if (labels[i] >= 0) stack[qt++] = i;
  while (qh < qt) {
    const p = stack[qh++], l = labels[p], x = p % RES;
    for (const q of [x > 0 ? p - 1 : -1, x < RES - 1 ? p + 1 : -1, p - RES, p + RES])
      if (q >= 0 && q < T && labels[q] === -1) { labels[q] = l; stack[qt++] = q; }
  }
  const identity = Int32Array.from({ length: n }, (_, i) => i);
  const polys: number[][][] = [];
  traceGroups(labels, RES, identity, n, 1.1, polys);
  const faces: FaceGeom[] = Array.from({ length: n }, (_, i) => {
    const loops = polysToLoops(polys[i] ?? []);
    return { loops, area: 0, bbox: loopsBBox(loops) };
  });
  return { engine: "raster", labels, faces, hit: new HitIndex(faces, GRID_SPACE), t };
}

/* ---------- requests ---------- */

function conceptIds(e: Entry, c: Concept) {
  const count = e.faces.length;
  const inside = new Float32Array(count), total = new Float32Array(count);
  const fn = SHAPES[c.shape];
  const N = 180, step = GRID_SPACE / N;
  for (let j = 0; j < N; j++) {
    const y = (j + 0.5) * step;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * step;
      const f = e.hit.find(x, y);
      if (f < 0) continue;
      total[f]++;
      if (fn(x / GRID_SPACE - 0.5, y / GRID_SPACE - 0.5, c.params)) inside[f]++;
    }
  }
  const ids: number[] = [];
  for (let f = 0; f < count; f++) if (total[f] && inside[f] / total[f] > 0.5) ids.push(f);
  return ids;
}

function union(e: Entry, groups: number[][]): string[] {
  if (e.engine === "vector") return e.arr.union(groups);
  const groupOf = new Int32Array(e.faces.length).fill(-1);
  groups.forEach((ids, g) => ids.forEach((l) => (groupOf[l] = g)));
  const polys: number[][][] = [];
  traceGroups(e.labels, RES, groupOf, groups.length, 1.1, polys);
  return groups.map((_, g) => polysToLoops(polys[g] ?? []).map(loopToPath).join(""));
}

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === "build") {
      const t0 = performance.now();
      let entry: Entry;
      try {
        entry = buildVector(msg.path, msg.transform);
      } catch (err) {
        console.warn(`[logofx] vector engine failed for ${msg.key}, using raster fallback:`, err);
        entry = buildRaster(msg.path, msg.transform);
      }
      putEntry(msg.key, entry);
      const paths = entry.faces.map((f) => f.loops.map(loopToPath).join(""));
      post({
        type: "built", id: msg.id, key: msg.key, engine: entry.engine, ms: performance.now() - t0,
        paths, faces: entry.faces.map((f) => ({ loops: f.loops, bbox: f.bbox })),
      });
      return;
    }
    if (msg.type === "remap") {
      const from = getEntry(msg.fromKey), to = getEntry(msg.toKey);
      if (!from || !to) throw new Error("Grid not built");
      post({ type: "remap", id: msg.id, fills: remap(from, to, msg.fills) });
      return;
    }
    const entry = getEntry(msg.key);
    if (!entry) throw new Error(`Grid ${msg.key} not built`);
    if (msg.type === "concept") post({ type: "concept", id: msg.id, ids: conceptIds(entry, msg.concept) });
    else post({ type: "union", id: msg.id, paths: union(entry, msg.groups) });
  } catch (err) {
    post({ type: "error", id: msg.id, message: String(err) });
  }
};
