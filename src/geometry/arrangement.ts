import {
  TAU, arcParam, insideLoops, loopToPath, reverseSeg, segArea, segBBox, segEnd, segLength, segPoint, segStart, segTangent, subSeg,
  type Arc, type FaceGeom, type Line, type Loop, type Seg,
} from "./seg";
import { loopsBBox } from "./hit";

/**
 * Exact planar arrangement of lines and circular arcs.
 *
 *  1. clip every curve to the artboard and add the artboard border
 *  2. intersect all pairs (incl. tangencies, collinear and co-circular overlaps)
 *  3. split curves at intersections, weld coincident vertices, drop duplicates
 *  4. prune dangling edges, sort half-edges around each vertex by tangent angle
 *     (ties broken by curvature), and walk faces
 *  5. disconnected rings become holes of the face that contains them
 *
 * All coordinates stay in the template's 240×240 space.
 */
const TOL = 1e-6; // geometric tolerance (artboard units)
const WELD = 1e-5; // vertices closer than this are the same vertex
const MIN_FACE_AREA = 1e-3;

export class Arrangement {
  faces: FaceGeom[] = [];
  paths: string[] = [];
  private heSeg: Seg[] = [];
  private heNext: Int32Array = new Int32Array(0);
  private heFace: Int32Array = new Int32Array(0);

  constructor(input: Seg[], readonly size: number) {
    const segs = clip(input, size);
    const params = segs.map(() => [0, 1] as number[]);
    intersectAll(segs, params);
    const { vx, edges } = split(segs, params);
    this.build(vx.length, edges);
  }

  private build(vertexCount: number, edgesIn: { u: number; v: number; s: Seg }[]) {
    // Prune dangling edges: they never bound an area.
    let edges = edgesIn;
    for (;;) {
      const deg = new Int32Array(vertexCount);
      for (const e of edges) { deg[e.u]++; deg[e.v]++; }
      const kept = edges.filter((e) => e.u === e.v || (deg[e.u] > 1 && deg[e.v] > 1));
      if (kept.length === edges.length) break;
      edges = kept;
    }

    const H = edges.length * 2;
    const from = new Int32Array(H), to = new Int32Array(H);
    const seg: Seg[] = new Array(H);
    const ang = new Float64Array(H), curv = new Float64Array(H);
    edges.forEach((e, i) => {
      seg[2 * i] = e.s; from[2 * i] = e.u; to[2 * i] = e.v;
      seg[2 * i + 1] = reverseSeg(e.s); from[2 * i + 1] = e.v; to[2 * i + 1] = e.u;
    });
    const out: number[][] = Array.from({ length: vertexCount }, () => []);
    for (let h = 0; h < H; h++) {
      const [tx, ty] = segTangent(seg[h], 0);
      let a = Math.atan2(ty, tx);
      if (a < 0) a += TAU;
      if (a >= TAU - 1e-9) a = 0;
      ang[h] = a;
      const s = seg[h];
      curv[h] = s.k === 0 ? 0 : Math.sign(s.da) / s.r;
      out[from[h]].push(h);
    }
    const pos = new Int32Array(H);
    for (const list of out) {
      list.sort((a, b) => (Math.abs(ang[a] - ang[b]) > 1e-9 ? ang[a] - ang[b] : curv[a] - curv[b]));
      list.forEach((h, i) => (pos[h] = i));
    }
    // Face on the left: leave v on the edge just clockwise of the twin.
    const next = new Int32Array(H);
    for (let h = 0; h < H; h++) {
      const list = out[to[h]], t = h ^ 1;
      next[h] = list[(pos[t] - 1 + list.length) % list.length];
    }

    // Walk cycles.
    const cycleOf = new Int32Array(H).fill(-1);
    const cycles: { hes: number[]; area: number }[] = [];
    for (let h = 0; h < H; h++) {
      if (cycleOf[h] >= 0) continue;
      const hes: number[] = [];
      let c = h, guard = 0;
      do { cycleOf[c] = cycles.length; hes.push(c); c = next[c]; } while (c !== h && ++guard < H + 1);
      let area = 0;
      for (const e of hes) area += segArea(seg[e]);
      cycles.push({ hes, area });
    }

    // Positive cycles are faces; negative ones are outer boundaries of components.
    const heFace = new Int32Array(H).fill(-1);
    const faces: FaceGeom[] = [];
    const faceOfCycle = new Int32Array(cycles.length).fill(-1);
    cycles.forEach((c, i) => {
      if (c.area <= MIN_FACE_AREA) return;
      const loop = c.hes.map((e) => seg[e]);
      faceOfCycle[i] = faces.length;
      faces.push({ loops: [loop], area: c.area, bbox: loopsBBox([loop]) });
    });
    let outer = -1, minArea = 0;
    cycles.forEach((c, i) => { if (c.area < minArea) { minArea = c.area; outer = i; } });
    cycles.forEach((c, i) => {
      if (c.area >= 0 || i === outer || c.area > -MIN_FACE_AREA) return;
      // A point just left of the ring lies in the face that encloses it.
      const s = seg[c.hes[0]];
      const [mx, my] = segPoint(s, 0.5), [tx, ty] = segTangent(s, 0.5);
      const px = mx - ty * 1e-4, py = my + tx * 1e-4;
      let best = -1;
      for (let f = 0; f < faces.length; f++) {
        const [x0, y0, x1, y1] = faces[f].bbox;
        if (px < x0 || px > x1 || py < y0 || py > y1) continue;
        if (insideLoops([faces[f].loops[0]], px, py) && (best < 0 || faces[f].area < faces[best].area)) best = f;
      }
      if (best < 0) return;
      faceOfCycle[i] = best;
      faces[best].loops.push(c.hes.map((e) => seg[e]));
      faces[best].area += c.area;
    });
    cycles.forEach((c, i) => { for (const e of c.hes) heFace[e] = faceOfCycle[i]; });

    const total = faces.reduce((a, f) => a + f.area, 0);
    if (!faces.length || Math.abs(total - this.size * this.size) / (this.size * this.size) > 0.002)
      throw new Error(`Arrangement area mismatch: ${total.toFixed(2)} vs ${this.size * this.size}`);

    this.faces = faces;
    this.paths = faces.map((f) => f.loops.map(loopToPath).join(""));
    this.heSeg = seg;
    this.heNext = next;
    this.heFace = heFace;
  }

  /** Exact outline of each group of faces: boundary half-edges chained into loops. */
  union(groups: number[][]): string[] {
    const groupOf = new Int32Array(this.faces.length).fill(-1);
    groups.forEach((ids, g) => ids.forEach((f) => { if (f >= 0 && f < groupOf.length) groupOf[f] = g; }));
    const gOf = (h: number) => (this.heFace[h] < 0 ? -1 : groupOf[this.heFace[h]]);
    const H = this.heSeg.length;
    const isB = (h: number) => gOf(h) >= 0 && gOf(h) !== gOf(h ^ 1);
    const used = new Uint8Array(H);
    const out = groups.map(() => "");
    for (let h = 0; h < H; h++) {
      if (used[h] || !isB(h)) continue;
      const g = gOf(h);
      const loop: Loop = [];
      let c = h, guard = 0;
      do {
        used[c] = 1;
        loop.push(this.heSeg[c]);
        let n = this.heNext[c], spin = 0;
        // Rotate around the vertex through same-group faces until we hit the boundary again.
        while (!(isB(n) && gOf(n) === g) && ++spin < 64) n = this.heNext[n ^ 1];
        c = n;
      } while (c !== h && !used[c] && ++guard < H);
      out[g] += loopToPath(mergeRuns(loop));
    }
    return out;
  }
}

/** Joins consecutive collinear lines and co-circular arcs so exported outlines stay minimal. */
export function mergeRuns(loop: Loop): Loop {
  const out: Loop = [];
  for (const s of loop) {
    const p = out[out.length - 1];
    if (p && p.k === 0 && s.k === 0) {
      const ax = p.x1 - p.x0, ay = p.y1 - p.y0, bx = s.x1 - s.x0, by = s.y1 - s.y0;
      if (Math.abs(ax * by - ay * bx) < 1e-9 * Math.hypot(ax, ay) * Math.hypot(bx, by) && ax * bx + ay * by > 0) {
        out[out.length - 1] = { k: 0, x0: p.x0, y0: p.y0, x1: s.x1, y1: s.y1 };
        continue;
      }
    }
    if (p && p.k === 1 && s.k === 1 && Math.abs(p.cx - s.cx) < TOL && Math.abs(p.cy - s.cy) < TOL && Math.abs(p.r - s.r) < TOL && Math.sign(p.da) === Math.sign(s.da) && Math.abs(p.da + s.da) < TAU - 1e-6) {
      out[out.length - 1] = { ...p, da: p.da + s.da };
      continue;
    }
    out.push(s);
  }
  // The loop's first and last pieces may also continue each other.
  if (out.length > 2) {
    const first = out[0], last = out[out.length - 1];
    const merged = mergePair(last, first);
    if (merged) { out[0] = merged; out.pop(); }
  }
  return out;
}

function mergePair(p: Seg, s: Seg): Seg | null {
  if (p.k === 0 && s.k === 0) {
    const ax = p.x1 - p.x0, ay = p.y1 - p.y0, bx = s.x1 - s.x0, by = s.y1 - s.y0;
    if (Math.abs(ax * by - ay * bx) < 1e-9 * Math.hypot(ax, ay) * Math.hypot(bx, by) && ax * bx + ay * by > 0) return { k: 0, x0: p.x0, y0: p.y0, x1: s.x1, y1: s.y1 };
  }
  if (p.k === 1 && s.k === 1 && Math.abs(p.cx - s.cx) < TOL && Math.abs(p.cy - s.cy) < TOL && Math.abs(p.r - s.r) < TOL && Math.sign(p.da) === Math.sign(s.da) && Math.abs(p.da + s.da) < TAU - 1e-6)
    return { ...p, da: p.da + s.da };
  return null;
}

/* ---------------- clipping ---------------- */

export function clip(input: Seg[], S: number): Seg[] {
  const out: Seg[] = [];
  const inBox = (x: number, y: number) => x >= -TOL && x <= S + TOL && y >= -TOL && y <= S + TOL;
  for (const s of input) {
    if (s.k === 0) {
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
      let t0 = 0, t1 = 1, ok = true;
      for (const [p, q] of [[-dx, s.x0], [dx, S - s.x0], [-dy, s.y0], [dy, S - s.y0]]) {
        if (Math.abs(p) < 1e-15) { if (q < -TOL) ok = false; continue; }
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
      }
      if (!ok || t1 - t0 < 1e-12) continue;
      const c = subSeg(s, t0, t1) as Line;
      // Lines lying on the border duplicate it; the border is added once below.
      const onBorder = (Math.abs(c.x0 - c.x1) < TOL && (Math.abs(c.x0) < TOL || Math.abs(c.x0 - S) < TOL)) ||
        (Math.abs(c.y0 - c.y1) < TOL && (Math.abs(c.y0) < TOL || Math.abs(c.y0 - S) < TOL));
      if (!onBorder && segLength(c) > WELD) out.push(c);
      continue;
    }
    const ts = [0, 1];
    for (const [axis, c] of [[0, 0], [0, S], [1, 0], [1, S]] as const) {
      const d = axis === 0 ? c - s.cx : c - s.cy;
      if (Math.abs(d) > s.r - TOL) continue; // outside or tangent: no crossing
      const h = Math.sqrt(Math.max(0, s.r * s.r - d * d));
      for (const sgn of [-1, 1]) {
        const phi = axis === 0 ? Math.atan2(sgn * h, d) : Math.atan2(d, sgn * h);
        const t = arcParam(s, phi);
        if (t > 0 && t < 1) ts.push(t);
      }
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i++) {
      if (ts[i + 1] - ts[i] < 1e-12) continue;
      // Sample several points: an outside arc can touch the border exactly at its midpoint.
      const keep = [0.25, 0.5, 0.75].every((u) => {
        const [px, py] = segPoint(s, ts[i] + (ts[i + 1] - ts[i]) * u);
        return inBox(px, py);
      });
      if (keep) out.push(subSeg(s, ts[i], ts[i + 1]));
    }
  }
  out.push(
    { k: 0, x0: 0, y0: 0, x1: S, y1: 0 }, { k: 0, x0: S, y0: 0, x1: S, y1: S },
    { k: 0, x0: S, y0: S, x1: 0, y1: S }, { k: 0, x0: 0, y0: S, x1: 0, y1: 0 },
  );
  return out;
}

/* ---------------- intersections ---------------- */

function intersectAll(segs: Seg[], params: number[][]) {
  const boxes = segs.map(segBBox);
  const order = segs.map((_, i) => i).sort((a, b) => boxes[a][0] - boxes[b][0]);
  // Sweep along x so only overlapping bounding boxes are tested.
  for (let ii = 0; ii < order.length; ii++) {
    const i = order[ii], bi = boxes[i];
    for (let jj = ii + 1; jj < order.length; jj++) {
      const j = order[jj], bj = boxes[j];
      if (bj[0] > bi[2] + TOL) break;
      if (bj[1] > bi[3] + TOL || bj[3] < bi[1] - TOL) continue;
      const a = segs[i], b = segs[j];
      if (a.k === 0 && b.k === 0) lineLine(a, b, params[i], params[j]);
      else if (a.k === 0 && b.k === 1) lineArc(a, b, params[i], params[j]);
      else if (a.k === 1 && b.k === 0) lineArc(b, a, params[j], params[i]);
      else arcArc(a as Arc, b as Arc, params[i], params[j]);
    }
  }
}

const within = (t: number, eps: number) => t >= -eps && t <= 1 + eps;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function lineLine(a: Line, b: Line, pa: number[], pb: number[]) {
  const ax = a.x1 - a.x0, ay = a.y1 - a.y0, bx = b.x1 - b.x0, by = b.y1 - b.y0;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  const den = ax * by - ay * bx;
  const ox = b.x0 - a.x0, oy = b.y0 - a.y0;
  if (Math.abs(den) < 1e-12 * la * lb) {
    if (Math.abs(ox * ay - oy * ax) / la > TOL) return; // parallel, not collinear
    const proj = (px: number, py: number, s: Line, l: number) => ((px - s.x0) * (s.x1 - s.x0) + (py - s.y0) * (s.y1 - s.y0)) / (l * l);
    for (const [px, py] of [[b.x0, b.y0], [b.x1, b.y1]]) { const t = proj(px, py, a, la); if (t > 0 && t < 1) pa.push(t); }
    for (const [px, py] of [[a.x0, a.y0], [a.x1, a.y1]]) { const t = proj(px, py, b, lb); if (t > 0 && t < 1) pb.push(t); }
    return;
  }
  const t = (ox * by - oy * bx) / den, u = (ox * ay - oy * ax) / den;
  if (within(t, TOL / la) && within(u, TOL / lb)) { pa.push(clamp01(t)); pb.push(clamp01(u)); }
}

function lineArc(l: Line, c: Arc, pl: number[], pc: number[]) {
  const dx = l.x1 - l.x0, dy = l.y1 - l.y0, len = Math.hypot(dx, dy);
  const fx = l.x0 - c.cx, fy = l.y0 - c.cy;
  const dist = Math.abs(fx * dy - fy * dx) / len;
  if (dist > c.r + TOL) return;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - c.r * c.r;
  const ts: number[] = [];
  if (dist > c.r - TOL) ts.push(-B / (2 * A)); // tangent
  else { const q = Math.sqrt(Math.max(0, B * B - 4 * A * C)); ts.push((-B - q) / (2 * A), (-B + q) / (2 * A)); }
  for (const t of ts) {
    if (!within(t, TOL / len)) continue;
    const x = l.x0 + dx * t, y = l.y0 + dy * t;
    const s = arcParam(c, Math.atan2(y - c.cy, x - c.cx), TOL);
    if (within(s, TOL / (c.r * Math.abs(c.da)))) { pl.push(clamp01(t)); pc.push(clamp01(s)); }
  }
}

function arcArc(a: Arc, b: Arc, pa: number[], pb: number[]) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy);
  if (d < TOL) {
    if (Math.abs(a.r - b.r) > TOL) return; // concentric
    // Same circle: split each at the other's endpoints.
    for (const [x, y] of [segStart(b), segEnd(b)]) { const t = arcParam(a, Math.atan2(y - a.cy, x - a.cx), TOL); if (t > 1e-9 && t < 1 - 1e-9) pa.push(t); }
    for (const [x, y] of [segStart(a), segEnd(a)]) { const t = arcParam(b, Math.atan2(y - b.cy, x - b.cx), TOL); if (t > 1e-9 && t < 1 - 1e-9) pb.push(t); }
    return;
  }
  if (d > a.r + b.r + TOL || d < Math.abs(a.r - b.r) - TOL) return;
  const along = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const tangent = Math.abs(d - (a.r + b.r)) < TOL || Math.abs(d - Math.abs(a.r - b.r)) < TOL;
  const h = tangent ? 0 : Math.sqrt(Math.max(0, a.r * a.r - along * along));
  const bx = a.cx + (along * dx) / d, by = a.cy + (along * dy) / d;
  const pts = h === 0 ? [[bx, by]] : [[bx - (h * dy) / d, by + (h * dx) / d], [bx + (h * dy) / d, by - (h * dx) / d]];
  for (const [x, y] of pts) {
    const ta = arcParam(a, Math.atan2(y - a.cy, x - a.cx), TOL), tb = arcParam(b, Math.atan2(y - b.cy, x - b.cx), TOL);
    if (within(ta, TOL / (a.r * Math.abs(a.da))) && within(tb, TOL / (b.r * Math.abs(b.da)))) { pa.push(clamp01(ta)); pb.push(clamp01(tb)); }
  }
}

/* ---------------- splitting & welding ---------------- */

function split(segs: Seg[], params: number[][]) {
  const vx: number[] = [], vy: number[] = [];
  const grid = new Map<number, number[]>();
  const cell = 1e-3;
  const K = 4_000_003; // > (artboard + padding) / cell, keeps keys unique
  const weld = (x: number, y: number) => {
    const gx = Math.floor(x / cell) + 1_000_000, gy = Math.floor(y / cell) + 1_000_000;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = grid.get((gx + i) * K + gy + j);
      if (list) for (const v of list) if (Math.hypot(vx[v] - x, vy[v] - y) < WELD) return v;
    }
    const id = vx.length;
    vx.push(x); vy.push(y);
    const k = gx * K + gy;
    const l = grid.get(k);
    if (l) l.push(id); else grid.set(k, [id]);
    return id;
  };

  const edges: { u: number; v: number; s: Seg }[] = [];
  // Duplicate detection: same endpoints, same kind, same midpoint ⇒ same curve.
  const seen = new Map<number, number[]>();
  segs.forEach((s, i) => {
    const ts = params[i].sort((a, b) => a - b);
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1] - ts[k] < 1e-12) continue;
      const sub = subSeg(s, ts[k], ts[k + 1]);
      const [x0, y0] = segStart(sub), [x1, y1] = segEnd(sub);
      const u = weld(x0, y0), v = weld(x1, y1);
      if (u === v && (sub.k === 0 || segLength(sub) < 10 * WELD)) continue;
      const geo: Seg = sub.k === 0 ? { k: 0, x0: vx[u], y0: vy[u], x1: vx[v], y1: vy[v] } : sub;
      const [mx, my] = segPoint(geo, 0.5);
      const pair = Math.min(u, v) * 16_777_216 + Math.max(u, v);
      const prev = seen.get(pair);
      if (prev && prev.some((e) => edges[e].s.k === geo.k && Math.hypot(segPoint(edges[e].s, 0.5)[0] - mx, segPoint(edges[e].s, 0.5)[1] - my) < 1e-3)) continue;
      if (prev) prev.push(edges.length); else seen.set(pair, [edges.length]);
      edges.push({ u, v, s: geo });
    }
  });
  return { vx, vy, edges };
}
