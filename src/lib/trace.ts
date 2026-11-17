/**
 * Turns a label raster into vector outlines.
 *
 * Every pixel belongs to a group (or -1). Boundary edges between pixels of
 * different groups are chained into closed loops (clockwise around the inside,
 * so holes come out counter-clockwise and `nonzero` fill works), then simplified
 * with Ramer–Douglas–Peucker. Output coordinates are in raster pixels.
 */
export function traceGroups(
  labels: Int32Array,
  res: number,
  groupOf: Int32Array,
  groupCount: number,
  epsilon = 1.1,
  polys?: number[][][],
): string[] {
  const V = res + 1;
  const VV = V * V;
  const next = new Map<number, number[]>();
  const add = (g: number, a: number, b: number) => {
    const k = g * VV + a;
    const r = next.get(k);
    if (r) r.push(b);
    else next.set(k, [b]);
  };
  const grp = (l: number) => (l < 0 ? -1 : groupOf[l]);

  for (let y = 0; y < res; y++) {
    const row = y * res;
    for (let x = 0; x < res; x++) {
      const g = grp(labels[row + x]);
      if (g < 0) continue;
      if (y === 0 || grp(labels[row + x - res]) !== g) add(g, y * V + x, y * V + x + 1);
      if (x === res - 1 || grp(labels[row + x + 1]) !== g) add(g, y * V + x + 1, (y + 1) * V + x + 1);
      if (y === res - 1 || grp(labels[row + x + res]) !== g) add(g, (y + 1) * V + x + 1, (y + 1) * V + x);
      if (x === 0 || grp(labels[row + x - 1]) !== g) add(g, (y + 1) * V + x, y * V + x);
    }
  }

  const out: string[] = new Array(groupCount).fill("");
  const xs: number[] = [];
  const ys: number[] = [];
  for (const key of next.keys()) {
    if (!next.has(key)) continue;
    const g = Math.floor(key / VV);
    const start = key - g * VV;
    xs.length = 0;
    ys.length = 0;
    let v = start;
    for (;;) {
      xs.push(v % V);
      ys.push((v / V) | 0);
      const k = g * VV + v;
      const arr = next.get(k);
      if (!arr) break;
      const n = arr.pop()!;
      if (!arr.length) next.delete(k);
      v = n;
      if (v === start) break;
    }
    if (xs.length < 3) continue;
    out[g] += loopToPath(xs, ys, epsilon, polys ? (polys[g] ??= []) : undefined);
  }
  return out;
}

function loopToPath(xs: number[], ys: number[], eps: number, sink?: number[][]): string {
  // Drop collinear vertices first; RDP then smooths the staircases.
  const cx: number[] = [];
  const cy: number[] = [];
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    const cross = (xs[i] - xs[p]) * (ys[q] - ys[i]) - (ys[i] - ys[p]) * (xs[q] - xs[i]);
    if (cross !== 0) { cx.push(xs[i]); cy.push(ys[i]); }
  }
  const m = cx.length;
  if (m < 3) return "";
  // Split the closed loop at its two most distant points.
  let far = 0, fd = -1;
  for (let i = 1; i < m; i++) {
    const d = (cx[i] - cx[0]) ** 2 + (cy[i] - cy[0]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const keep = new Uint8Array(m + 1);
  const px = (i: number) => cx[i % m];
  const py = (i: number) => cy[i % m];
  const stack: number[] = [0, far, far, m];
  keep[0] = keep[far] = keep[m] = 1;
  while (stack.length) {
    const b = stack.pop()!, a = stack.pop()!;
    const ax = px(a), ay = py(a), bx = px(b), by = py(b);
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * px(i) - dx * py(i) + bx * ay - by * ax) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (mi >= 0 && md > eps) {
      keep[mi] = 1;
      stack.push(a, mi, mi, b);
    }
  }
  const px2: number[] = [];
  const py2: number[] = [];
  for (let i = 0; i < m; i++) {
    if (!keep[i]) continue;
    // Collapse raster nubs (edges under 2px) left where curves meet straight lines.
    const k = px2.length - 1;
    if (k >= 0 && Math.hypot(cx[i] - px2[k], cy[i] - py2[k]) < 2) {
      px2[k] = (px2[k] + cx[i]) / 2;
      py2[k] = (py2[k] + cy[i]) / 2;
      continue;
    }
    px2.push(cx[i]);
    py2.push(cy[i]);
  }
  return smoothToPath(px2, py2, sink);
}

/**
 * Corner-preserving Chaikin smoothing: vertices where the outline turns sharply
 * (line intersections) stay put, gentle turns (curves sampled by RDP) are cut
 * twice, which turns raster-traced arcs back into smooth curves.
 */
function smoothToPath(xs: number[], ys: number[], sink?: number[][]): string {
  let X = xs, Y = ys;
  const n0 = X.length;
  if (n0 < 3) return "";
  let corner = new Uint8Array(n0);
  for (let i = 0; i < n0; i++) {
    const p = (i - 1 + n0) % n0, q = (i + 1) % n0;
    const ax = X[i] - X[p], ay = Y[i] - Y[p], bx = X[q] - X[i], by = Y[q] - Y[i];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const cos = (ax * bx + ay * by) / (la * lb || 1);
    // A turn sharper than ~37° is a real corner (line intersection), not a sampled curve.
    corner[i] = cos < 0.8 ? 1 : 0;
  }
  for (let it = 0; it < 2; it++) {
    const n = X.length;
    const NX: number[] = [], NY: number[] = [];
    const NC: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n, q = (i + 1) % n;
      if (corner[i]) { NX.push(X[i]); NY.push(Y[i]); NC.push(1); continue; }
      NX.push(0.25 * X[p] + 0.75 * X[i]); NY.push(0.25 * Y[p] + 0.75 * Y[i]); NC.push(0);
      NX.push(0.75 * X[i] + 0.25 * X[q]); NY.push(0.75 * Y[i] + 0.25 * Y[q]); NC.push(0);
    }
    X = NX; Y = NY; corner = Uint8Array.from(NC);
  }
  if (sink) { const flat: number[] = []; for (let i = 0; i < X.length; i++) flat.push(X[i], Y[i]); sink.push(flat); }
  let d = "M" + r1(X[0]) + " " + r1(Y[0]);
  for (let i = 1; i < X.length; i++) d += "L" + r1(X[i]) + " " + r1(Y[i]);
  return d + "Z";
}
const r1 = (v: number) => Math.round(v * 10) / 10;
