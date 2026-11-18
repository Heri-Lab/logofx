import { useEffect, useMemo, useState } from "react";
import { traceUnion, useRegions, type RegionSet } from "./regions";
import { EMPTY_FILLS, layer3d, unpackFill, useEditor, useTransform, useView, type Fills } from "@/store/editor";

/**
 * Faces for 3D extrusion. A face is a connected group of shapes with the same fill value
 * (same layer, colour and depth) — what reads as one surface on the tilted canvas.
 * Adjacency comes from probing just across each edge of a shape's outline.
 */

const adjacencyCache = new WeakMap<RegionSet, Set<number>[]>();
const PROBE = 0.6;

/** Vertices of an absolute M/L/A/Z path, as rings. */
function rings(d: string) {
  const out: [number, number][][] = [];
  let ring: [number, number][] = [];
  const re = /([MLAZ])([^MLAZ]*)/gi;
  for (const m of d.matchAll(re)) {
    const cmd = m[1].toUpperCase();
    const n = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === "M") { if (ring.length) out.push(ring); ring = [[n[0], n[1]]]; }
    else if (cmd === "L") for (let i = 0; i + 1 < n.length; i += 2) ring.push([n[i], n[i + 1]]);
    else if (cmd === "A") for (let i = 0; i + 6 < n.length; i += 7) ring.push([n[i + 5], n[i + 6]]);
    else if (cmd === "Z") { if (ring.length) out.push(ring); ring = []; }
  }
  if (ring.length) out.push(ring);
  return out;
}

export function adjacency(rs: RegionSet) {
  let adj = adjacencyCache.get(rs);
  if (adj) return adj;
  adj = rs.paths.map(() => new Set<number>());
  rs.paths.forEach((d, id) => {
    for (const ring of rings(d))
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 1e-6) continue;
        const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
        // Probe both sides of the edge at a few points; whatever isn't this shape touches it.
        for (const t of [0.25, 0.5, 0.75])
          for (const s of [PROBE, -PROBE]) {
            const other = rs.hit.find(x0 + (x1 - x0) * t + nx * s, y0 + (y1 - y0) * t + ny * s);
            if (other >= 0 && other !== id) { adj![id].add(other); adj![other].add(id); }
          }
      }
  });
  adjacencyCache.set(rs, adj);
  return adj;
}

/** The face containing `id`: connected shapes with exactly the same fill value. */
export function faceAt(rs: RegionSet, fills: Fills, id: number) {
  const v = fills[id];
  if (v === undefined) return [];
  const adj = adjacency(rs);
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of adj[cur] ?? []) if (!seen.has(n) && fills[n] === v) { seen.add(n); stack.push(n); }
  }
  return [...seen];
}

/** The picked face on the current grid with its layer, colour, depth and traced outline; null if none. */
export function useFaceInfo() {
  const face = useView((s) => s.face);
  const templateId = useEditor((s) => s.templateId);
  const density = useEditor((s) => s.density);
  const transform = useTransform();
  const { regions } = useRegions(templateId, density, transform);
  const fills = useEditor((s) => (face ? s.fills[face.key] ?? EMPTY_FILLS : EMPTY_FILLS));
  const layers = useEditor((s) => s.layers);
  const [outline, setOutline] = useState<{ ids: number[]; d: string } | null>(null);

  const valid = !!face && !!regions && face.key === regions.key && face.ids.length > 0 && face.ids.every((id) => fills[id] !== undefined);
  useEffect(() => {
    if (!valid || !face) return;
    let alive = true;
    traceUnion(face.key, [face.ids]).then((r) => alive && setOutline({ ids: face.ids, d: r.paths[0] ?? "" }));
    return () => { alive = false; };
  }, [valid, face]);

  return useMemo(() => {
    if (!valid || !face) return null;
    const f = unpackFill(fills[face.ids[0]]);
    const layer = layers.find((l) => l.id === f.layer) ?? layers[0];
    return {
      key: face.key,
      ids: face.ids,
      layer,
      color: f.color,
      depth: f.depth ?? layer3d(layer).extrude,
      d: outline?.ids === face.ids ? outline.d : null,
    };
  }, [valid, face, fills, layers, outline]);
}

/** Sets a face's depth as one undoable step (for typed values; drags wrap their own stroke). */
export function commitFaceDepth(key: string, ids: number[], depth: number | null) {
  const ed = useEditor.getState();
  ed.beginStroke(key);
  ed.setDepth(key, ids, depth);
  ed.endStroke(key);
}

/** Rewrites (or with null, removes) some shapes' fills as one undoable step. */
export function editShapes(key: string, ids: number[], f: (v: string) => string | null) {
  const ed = useEditor.getState();
  const next = { ...(ed.fills[key] ?? EMPTY_FILLS) };
  for (const id of ids) {
    const v = next[id];
    if (v === undefined) continue;
    const r = f(v);
    if (r === null) delete next[id];
    else next[id] = r;
  }
  ed.commit(key, next);
}
