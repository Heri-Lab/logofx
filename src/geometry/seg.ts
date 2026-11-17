/**
 * Exact curve primitives used by the vector arrangement engine.
 * Lines run from (x0,y0) to (x1,y1); arcs run from angle a0 by signed sweep da
 * (angles via atan2 in the artboard's coordinate system).
 */
export type Line = { k: 0; x0: number; y0: number; x1: number; y1: number };
export type Arc = { k: 1; cx: number; cy: number; r: number; a0: number; da: number };
export type Seg = Line | Arc;
export type Loop = Seg[];
export interface FaceGeom { loops: Loop[]; area: number; bbox: [number, number, number, number] }

export const TAU = Math.PI * 2;

export function segPoint(s: Seg, t: number): [number, number] {
  if (s.k === 0) return [s.x0 + (s.x1 - s.x0) * t, s.y0 + (s.y1 - s.y0) * t];
  const a = s.a0 + s.da * t;
  return [s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)];
}
export const segStart = (s: Seg) => segPoint(s, 0);
export const segEnd = (s: Seg) => segPoint(s, 1);

export function reverseSeg(s: Seg): Seg {
  return s.k === 0 ? { k: 0, x0: s.x1, y0: s.y1, x1: s.x0, y1: s.y0 } : { k: 1, cx: s.cx, cy: s.cy, r: s.r, a0: s.a0 + s.da, da: -s.da };
}

export function subSeg(s: Seg, t0: number, t1: number): Seg {
  if (s.k === 0) {
    const [x0, y0] = segPoint(s, t0), [x1, y1] = segPoint(s, t1);
    return { k: 0, x0, y0, x1, y1 };
  }
  return { k: 1, cx: s.cx, cy: s.cy, r: s.r, a0: s.a0 + s.da * t0, da: s.da * (t1 - t0) };
}

/** Unit tangent at parameter t, in the direction of travel. */
export function segTangent(s: Seg, t: number): [number, number] {
  if (s.k === 0) {
    const dx = s.x1 - s.x0, dy = s.y1 - s.y0, l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }
  const a = s.a0 + s.da * t, sg = Math.sign(s.da);
  return [-Math.sin(a) * sg, Math.cos(a) * sg];
}

export const segLength = (s: Seg) => (s.k === 0 ? Math.hypot(s.x1 - s.x0, s.y1 - s.y0) : Math.abs(s.da) * s.r);

/** Position of angle φ along an arc as a parameter; values in [0,1] lie on the arc. */
export function arcParam(s: Arc, phi: number, tol = 1e-9): number {
  let raw = ((phi - s.a0) * Math.sign(s.da)) % TAU;
  if (raw < 0) raw += TAU;
  const span = Math.abs(s.da);
  if (raw > TAU - tol / Math.max(s.r, 1e-9) && span < TAU - 1e-9) raw -= TAU;
  return raw / span;
}

export function segBBox(s: Seg): [number, number, number, number] {
  if (s.k === 0) return [Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.max(s.x0, s.x1), Math.max(s.y0, s.y1)];
  const [x0, y0] = segStart(s), [x1, y1] = segEnd(s);
  let b: [number, number, number, number] = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  for (let q = 0; q < 4; q++) {
    const phi = (q * Math.PI) / 2;
    const t = arcParam(s, phi, 0);
    if (t >= 0 && t <= 1) {
      const x = s.cx + s.r * Math.cos(phi), y = s.cy + s.r * Math.sin(phi);
      b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    }
  }
  return b;
}

/** ∮ (x dy − y dx) / 2 contribution, so a loop's signed area is the sum over its segments. */
export function segArea(s: Seg): number {
  if (s.k === 0) return (s.x0 * s.y1 - s.x1 * s.y0) / 2;
  const [x0, y0] = segStart(s), [x1, y1] = segEnd(s);
  return (s.r * s.r * s.da + s.cx * (y1 - y0) - s.cy * (x1 - x0)) / 2;
}

const n3 = (v: number) => {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? "0" : String(r);
};

/** SVG path for a closed loop, with true arc commands. */
export function loopToPath(loop: Loop): string {
  if (!loop.length) return "";
  const [sx, sy] = segStart(loop[0]);
  let d = `M${n3(sx)} ${n3(sy)}`;
  for (const s of loop) {
    if (s.k === 0) { d += `L${n3(s.x1)} ${n3(s.y1)}`; continue; }
    // Split near-full sweeps so SVG never sees coincident arc endpoints.
    const parts = Math.abs(s.da) > Math.PI * 1.5 ? 2 : 1;
    for (let i = 1; i <= parts; i++) {
      const sub = subSeg(s, (i - 1) / parts, i / parts) as Arc;
      const [ex, ey] = segEnd(sub);
      d += `A${n3(s.r)} ${n3(s.r)} 0 ${Math.abs(sub.da) > Math.PI ? 1 : 0} ${sub.da > 0 ? 1 : 0} ${n3(ex)} ${n3(ey)}`;
    }
  }
  return d + "Z";
}

/** Even-odd point containment against a set of loops (outer + holes). */
export function insideLoops(loops: Loop[], px: number, py: number): boolean {
  let inside = false;
  for (const loop of loops)
    for (const s of loop) {
      if (s.k === 0) {
        if (s.y0 > py !== s.y1 > py) {
          const x = s.x0 + ((py - s.y0) * (s.x1 - s.x0)) / (s.y1 - s.y0);
          if (x > px) inside = !inside;
        }
        continue;
      }
      const dy = py - s.cy;
      if (Math.abs(dy) >= s.r) continue;
      const dx = Math.sqrt(s.r * s.r - dy * dy);
      for (const x of [s.cx - dx, s.cx + dx]) {
        if (x <= px) continue;
        const t = arcParam(s, Math.atan2(dy, x - s.cx), 0);
        // Half-open on the parameter so shared endpoints are counted once.
        if (t >= 0 && t < 1) inside = !inside;
      }
    }
  return inside;
}

/** Applies a similarity transform (rotation, uniform scale, flips, translation). Arcs stay exact. */
export function transformSegs(
  segs: Seg[],
  m: readonly [number, number, number, number, number, number],
  t: { rotate: number; scale: number; flipX: boolean; flipY: boolean },
): Seg[] {
  const [a, b, c, d, e, f] = m;
  const P = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];
  const rot = (t.rotate * Math.PI) / 180;
  const mirror = t.flipX !== t.flipY;
  const ang = (th: number) => (t.flipX && t.flipY ? th + Math.PI : t.flipX ? Math.PI - th : t.flipY ? -th : th) + rot;
  return segs.map((s) => {
    if (s.k === 0) {
      const [x0, y0] = P(s.x0, s.y0), [x1, y1] = P(s.x1, s.y1);
      return { k: 0, x0, y0, x1, y1 };
    }
    const [cx, cy] = P(s.cx, s.cy);
    return { k: 1, cx, cy, r: s.r * t.scale, a0: ang(s.a0), da: mirror ? -s.da : s.da };
  });
}

/**
 * Projective transform. Lines map exactly; arcs become conics, so they are flattened into
 * chords within `tol` (artboard units). Each half-arc gets an even number of chords so the
 * quarter points (where our grids' circles touch each other and the border) stay vertices,
 * keeping tangent circles watertight.
 *
 * Everything is first clipped in template space to `pre` — the convex pre-image of the
 * (slightly padded) artboard — so geometry near or behind the horizon is never projected.
 */
export function projectSegs(segs: Seg[], H: readonly number[], pre: [number, number][], tol = 0.03): Seg[] {
  const P = (x: number, y: number): [number, number] => {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  };
  // Pre-image polygon as inward half-planes (works for either winding).
  let area = 0;
  for (let i = 0; i < pre.length; i++) { const [ax, ay] = pre[i], [bx, by] = pre[(i + 1) % pre.length]; area += ax * by - bx * ay; }
  const sgn = Math.sign(area) || 1;
  const planes = pre.map(([ax, ay], i) => {
    const [bx, by] = pre[(i + 1) % pre.length];
    return [-(by - ay) * sgn, (bx - ax) * sgn, ax, ay] as const; // inward normal, point on edge
  });
  let qx0 = Infinity, qy0 = Infinity, qx1 = -Infinity, qy1 = -Infinity;
  for (const [x, y] of pre) { qx0 = Math.min(qx0, x); qy0 = Math.min(qy0, y); qx1 = Math.max(qx1, x); qy1 = Math.max(qy1, y); }

  const out: Seg[] = [];
  const emit = (x0: number, y0: number, x1: number, y1: number) => {
    // Cyrus–Beck clip against the convex pre-image.
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    for (const [nx, ny, px, py] of planes) {
      const num = nx * (x0 - px) + ny * (y0 - py), den = nx * dx + ny * dy;
      if (Math.abs(den) < 1e-15) { if (num < 0) return; continue; }
      const t = -num / den;
      if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      if (t0 > t1) return;
    }
    const [ax, ay] = P(x0 + dx * t0, y0 + dy * t0), [bx, by] = P(x0 + dx * t1, y0 + dy * t1);
    if (Math.hypot(bx - ax, by - ay) > 1e-9) out.push({ k: 0, x0: ax, y0: ay, x1: bx, y1: by });
  };

  for (const s of segs) {
    if (s.k === 0) { emit(s.x0, s.y0, s.x1, s.y1); continue; }
    const [bx0, by0, bx1, by1] = segBBox(s);
    if (bx1 < qx0 || by1 < qy0 || bx0 > qx1 || by0 > qy1) continue;
    // Chord count from the arc's largest on-screen curvature radius (sampled where visible).
    const K = 8, dth = Math.abs(s.da) / K;
    let rEff = 0, prev: [number, number] | null = null;
    for (let i = 0; i <= K; i++) {
      const [tx, ty] = segPoint(s, i / K);
      const w = H[6] * tx + H[7] * ty + H[8];
      if (w <= 1e-6) { prev = null; continue; }
      const q = P(tx, ty);
      if (prev) rEff = Math.max(rEff, Math.hypot(q[0] - prev[0], q[1] - prev[1]) / (2 * Math.sin(dth / 2)));
      prev = q;
    }
    rEff = Math.max(rEff * 1.25, tol);
    const step = 2 * Math.acos(Math.max(-1, 1 - tol / rEff));
    let n = Math.max(4, Math.ceil(Math.abs(s.da) / step));
    n += n % 2;
    let [px, py] = segPoint(s, 0);
    for (let i = 1; i <= n; i++) {
      const [qx, qy] = segPoint(s, i / n);
      emit(px, py, qx, qy);
      px = qx; py = qy;
    }
  }
  return out;
}

/** Open SVG path for a list of segments (each its own subpath). */
export function segsToPath(segs: Seg[]): string {
  let d = "";
  for (const s of segs) {
    const [sx, sy] = segStart(s);
    d += `M${n3(sx)} ${n3(sy)}`;
    if (s.k === 0) d += `L${n3(s.x1)} ${n3(s.y1)}`;
    else {
      const [ex, ey] = segEnd(s);
      d += `A${n3(s.r)} ${n3(s.r)} 0 ${Math.abs(s.da) > Math.PI ? 1 : 0} ${s.da > 0 ? 1 : 0} ${n3(ex)} ${n3(ey)}`;
    }
  }
  return d;
}
