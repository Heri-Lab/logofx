/** Grid templates. Every path lives in a 240×240 coordinate space. */
import { apply, fromAffine, inv, mul, type Mat3 } from "@/geometry/mat3";
import { generatePath, type CustomGridDef } from "./generator";
export const GRID_SPACE = 240;
const S = GRID_SPACE;
const PHI = 1.618;

// Keep full precision: rounding breaks exact tangencies (e.g. spiral arcs touching the border).
const f = (v: number) => +v.toFixed(9);
const C = (x: number, y: number, r: number) =>
  `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
const L = (a: number, b: number, c: number, d: number) => `M${f(a)} ${f(b)}L${f(c)} ${f(d)}`;

/** Region of template space a pattern is generated over. The artboard is [0, 240]. */
export type Domain = readonly [number, number];
const ARTBOARD: Domain = [0, S];

/** Multiples of `step` (+ offset) strictly inside the domain. */
function* steps(step: number, [lo, hi]: Domain, offset = 0) {
  for (let k = Math.ceil((lo - offset) / step) * step + offset; k < hi - 1e-9; k += step) if (k > lo + 1e-9) yield k;
}
/** Multiples of `step` (+ offset) within the domain. */
function* centers(step: number, [lo, hi]: Domain, offset: number) {
  for (let k = Math.ceil((lo - offset) / step) * step + offset; k <= hi + 1e-9; k += step) yield k;
}
const square = (step: number, d: Domain) => {
  let s = "";
  for (const k of steps(step, d)) s += L(k, d[0], k, d[1]) + L(d[0], k, d[1], k);
  return s;
};
/** Parallel lines through (k, 0) at `angle`; k is anchored at −720 so the default artboard is unchanged. */
const slant = (step: number, angle: number, [lo, hi]: Domain) => {
  const cot = 1 / Math.tan((angle * Math.PI) / 180);
  const kMin = lo - Math.max(lo * cot, hi * cot) - step, kMax = hi - Math.min(lo * cot, hi * cot) + step;
  let s = "";
  for (let k = -720 + Math.ceil((kMin + 720) / step) * step; k <= kMax; k += step) s += L(k + lo * cot, lo, k + hi * cot, hi);
  return s;
};

export interface GridTemplate {
  id: string;
  name: string;
  /** Square grid is the only template that honours density. */
  usesDensity?: boolean;
  /** Repeating patterns are regenerated past the artboard when transformed; compositions are not. */
  tiles?: boolean;
  path: (density: number, domain?: Domain) => string;
}

const memo = (build: (d: Domain) => string) => {
  const cache = new Map<string, string>();
  return (d: Domain) => {
    const k = d.join(",");
    let v = cache.get(k);
    if (v === undefined) {
      v = build(d);
      if (cache.size > 24) cache.delete(cache.keys().next().value!);
      cache.set(k, v);
    }
    return v;
  };
};
const tiled = (id: string, name: string, build: (d: Domain) => string): GridTemplate => {
  const m = memo(build);
  return { id, name, tiles: true, path: (_n, d = ARTBOARD) => m(d) };
};
const composed = (id: string, name: string, build: () => string): GridTemplate => {
  let cache: string | null = null;
  return { id, name, path: () => (cache ??= build()) };
};

export const TEMPLATES: GridTemplate[] = [
  { id: "square", name: "Square", usesDensity: true, tiles: true, path: (n, d = ARTBOARD) => square(S / n, d) },
  tiled("dots", "Dot circles", (d) => {
    let s = "";
    for (const x of centers(15, d, 7.5)) if (x < d[1]) for (const y of centers(15, d, 7.5)) if (y < d[1]) s += C(x, y, 7.5);
    return s;
  }),
  tiled("isometric", "Isometric", (d) => {
    let s = "";
    for (const x of steps(30, d)) s += L(x, d[0], x, d[1]);
    return s + slant(34.64, 30, d) + slant(34.64, 150, d);
  }),
  tiled("square-diagonal", "Square + diagonals", (d) => square(30, d) + slant(30, 45, d) + slant(30, 135, d)),
  tiled("triangles", "Triangles", (d) => {
    let s = "";
    for (const y of steps(20.78, d)) s += L(d[0], y, d[1], y);
    return s + slant(24, 60, d) + slant(24, 120, d);
  }),
  tiled("overlap", "Overlapping circles", (d) => {
    let s = "";
    for (const x of centers(60, d, 0)) for (const y of centers(60, d, 0)) s += C(x, y, 60);
    return s;
  }),
  composed("circle-square", "Circle in square", () => square(30, ARTBOARD) + C(120, 120, 120) + C(120, 120, 60) + L(0, 0, S, S) + L(S, 0, 0, S)),
  composed("radial", "Radial", () => {
    let s = "";
    for (let r = 20; r <= 120; r += 20) s += C(120, 120, r);
    return s + L(0, 0, S, S) + L(S, 0, 0, S) + L(120, 0, 120, S) + L(0, 120, S, 120);
  }),
  tiled("vertical-triangles", "Vertical triangles", (d) => {
    let s = "";
    for (const x of steps(20, d)) s += L(x, d[0], x, d[1]);
    return s + slant(40, 60, d) + slant(40, 120, d);
  }),
  composed("polar", "Polar", () => {
    let s = "";
    for (let r = 15; r <= 120; r += 15) s += C(120, 120, r);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      s += L(120, 120, 120 + 120 * Math.cos(a), 120 + 120 * Math.sin(a));
    }
    return s;
  }),
  composed("golden-circles", "Golden circles", () => {
    let s = L(0, 120, S, 120) + L(120, 0, 120, S);
    let r = 120;
    for (let i = 0; i < 5; i++) {
      s += C(120, S - r, r) + C(120, r, r) + C(r, 120, r) + C(S - r, 120, r);
      r /= PHI;
    }
    return s;
  }),
  tiled("hexagons", "Hexagons", ([lo, hi]) => {
    let s = "";
    const R = 20, h = R * Math.sqrt(3);
    for (let col = Math.floor((lo - R) / (1.5 * R)) - 1; col * 1.5 * R < hi + R; col++)
      for (let row = Math.floor((lo - h) / h) - 1; row * h < hi + h; row++) {
        const cx = col * 1.5 * R, cy = row * h + (((col % 2) + 2) % 2 ? h / 2 : 0);
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          s += (k ? "L" : "M") + f(cx + R * Math.cos(a)) + " " + f(cy + R * Math.sin(a));
        }
        s += "Z";
      }
    return s;
  }),
  tiled("lattice", "Diagonal lattice", (d) => square(40, d) + slant(40, 45, d) + slant(40, 135, d)),
  composed("thirds", "Rule of thirds", () => {
    let s = square(80, ARTBOARD) + L(0, 0, S, S) + L(S, 0, 0, S) + C(120, 120, 120) + C(120, 120, 40);
    for (const x of [80, 160]) for (const y of [80, 160]) s += C(x, y, 40);
    return s;
  }),
  composed("nested", "Nested squares", () => {
    let s = "";
    for (let i = 0; i < 120; i += 15) s += `M${i} ${i}H${S - i}V${S - i}H${i}Z`;
    return s + "M120 0L240 120L120 240L0 120Z" + L(0, 0, S, S) + L(S, 0, 0, S) + L(120, 0, 120, S) + L(0, 120, S, 120);
  }),
  composed("spiral", "Golden spiral", () => {
    const W = S, H = W / PHI, y0 = (S - H) / 2;
    let s = `M0 ${f(y0)}H${W}V${f(y0 + H)}H0Z`;
    let x = 0, y = y0, w = W, h = H;
    for (let i = 0; i < 8; i++) {
      const q = Math.min(w, h);
      switch (i % 4) {
        case 0: s += L(x + q, y, x + q, y + h) + `M${f(x)} ${f(y + q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + q)} ${f(y)}`; x += q; w -= q; break;
        case 1: s += L(x, y + q, x + w, y + q) + `M${f(x + w - q)} ${f(y)}A${f(q)} ${f(q)} 0 0 1 ${f(x + w)} ${f(y + q)}`; y += q; h -= q; break;
        case 2: s += L(x + w - q, y, x + w - q, y + h) + `M${f(x + w)} ${f(y + h - q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + w - q)} ${f(y + h)}`; w -= q; break;
        default: s += L(x, y + h - q, x + w, y + h - q) + `M${f(x + q)} ${f(y + h)}A${f(q)} ${f(q)} 0 0 1 ${f(x)} ${f(y + h - q)}`; h -= q;
      }
    }
    return s;
  }),
  tiled("cell-circles", "Cell circles", (d) => {
    let s = square(40, d);
    for (const x of centers(40, d, 20)) if (x < d[1]) for (const y of centers(40, d, 20)) if (y < d[1]) s += C(x, y, 20) + C(x, y, 8);
    return s;
  }),
  tiled("arcs", "Quarter arcs", (d) => {
    let s = square(60, d);
    const i0 = Math.floor(d[0] / 60), i1 = Math.ceil(d[1] / 60);
    for (let i = i0; i < i1; i++)
      for (let j = i0; j < i1; j++) {
        const x = i * 60, y = j * 60;
        for (const r of [30, 60])
          s += (((i + j) % 2) + 2) % 2
            ? `M${x + r} ${y}A${r} ${r} 0 0 1 ${x} ${y + r}`
            : `M${x + 60 - r} ${y}A${r} ${r} 0 0 0 ${x + 60} ${y + r}`;
      }
    return s;
  }),
];

export const DENSITIES = [8, 12, 16, 24] as const;
export type Density = (typeof DENSITIES)[number];
/* ---------------- generated (custom) grids ---------------- */

const custom = new Map<string, GridTemplate>();
/** Makes a generated grid available everywhere a built-in template is (engine, transforms, export). */
export function registerCustomGrid(def: CustomGridDef) {
  const cache = new Map<string, string>();
  custom.set(def.id, {
    id: def.id,
    name: def.name,
    tiles: true,
    path: (_n, d = ARTBOARD) => {
      const k = d.join(",");
      let v = cache.get(k);
      if (v === undefined) {
        v = generatePath(def.layers, d);
        if (cache.size > 12) cache.delete(cache.keys().next().value!);
        cache.set(k, v);
      }
      return v;
    },
  });
}
export const unregisterCustomGrid = (id: string) => custom.delete(id);

export const getTemplate = (id: string) => custom.get(id) ?? TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

/* ---------------- grid transform ---------------- */

/**
 * Grid transform about the artboard centre. Rotate/scale/offset/flip form a similarity
 * (circles stay circles, geometry stays exact); tilt adds a perspective projection.
 */
export interface GridTransform {
  rotate: number; // degrees, clockwise on screen
  scale: number; // 1 = 100%
  x: number; // offset in artboard units
  y: number;
  flipX: boolean;
  flipY: boolean;
  tiltX?: number; // degrees, top edge recedes when positive
  tiltY?: number; // degrees, right edge recedes when positive
}
export const IDENTITY: GridTransform = { rotate: 0, scale: 1, x: 0, y: 0, flipX: false, flipY: false, tiltX: 0, tiltY: 0 };
export const hasPerspective = (t: GridTransform) => !!(t.tiltX || t.tiltY);
export const isIdentity = (t: GridTransform) =>
  t.rotate % 360 === 0 && t.scale === 1 && t.x === 0 && t.y === 0 && !t.flipX && !t.flipY && !hasPerspective(t);

/** Camera distance for the perspective projection, in artboard units. */
const FOCAL = 3 * S;

/** Full template → artboard mapping as a homography (similarity, then perspective tilt). */
export function homography(t: GridTransform): Mat3 {
  const sim = fromAffine(transformMatrix(t));
  if (!hasPerspective(t)) return sim;
  const ax = (-(t.tiltX ?? 0) * Math.PI) / 180, ay = ((t.tiltY ?? 0) * Math.PI) / 180;
  const c = S / 2;
  // Rotate the plane in 3D (about its centre), then project onto the screen.
  const M: Mat3 = [
    Math.cos(ay), Math.sin(ax) * Math.sin(ay), 0,
    0, Math.cos(ax), 0,
    -Math.sin(ay) / FOCAL, (Math.sin(ax) * Math.cos(ay)) / FOCAL, 1,
  ];
  const P = mul(mul([1, 0, c, 0, 1, c, 0, 0, 1], M), [1, 0, -c, 0, 1, -c, 0, 0, 1]);
  return mul(P, sim);
}

/** SVG matrix(a b c d e f) mapping template space → artboard. */
export function transformMatrix(t: GridTransform): [number, number, number, number, number, number] {
  const r = (t.rotate * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const sx = t.scale * (t.flipX ? -1 : 1), sy = t.scale * (t.flipY ? -1 : 1);
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
  const cx = S / 2, cy = S / 2;
  return [a, b, c, d, cx + t.x - (a * cx + c * cy), cy + t.y - (b * cx + d * cy)];
}

/** Template-space domain that covers the whole artboard after the transform (bucketed so paths cache). */
function coverDomain(t: GridTransform): Domain {
  let reach = (Math.SQRT2 * (S / 2) + Math.hypot(t.x, t.y)) / t.scale;
  if (hasPerspective(t)) {
    // Pull the artboard corners back into template space through the inverse projection.
    const H = inv(homography(t));
    for (const [x, y] of [[0, 0], [S, 0], [S, S], [0, S]]) {
      const [u, v] = apply(H, x, y);
      reach = Math.max(reach, Math.hypot(u - S / 2, v - S / 2));
    }
  }
  const R = Math.min(1440, Math.ceil(reach / 60) * 60);
  return [S / 2 - R, S / 2 + R];
}

const tKey = (t: GridTransform) =>
  isIdentity(t)
    ? ""
    : `|r${+t.rotate.toFixed(2)}s${+t.scale.toFixed(3)}x${+t.x.toFixed(2)}y${+t.y.toFixed(2)}${t.flipX ? "h" : ""}${t.flipY ? "v" : ""}` +
      (hasPerspective(t) ? `p${+(t.tiltX ?? 0).toFixed(1)},${+(t.tiltY ?? 0).toFixed(1)}` : "");

export const baseKeyOf = (templateId: string, density: number) =>
  getTemplate(templateId).usesDensity ? `${templateId}-${density}` : templateId;
export const gridKeyOf = (templateId: string, density: number, t: GridTransform = IDENTITY) => baseKeyOf(templateId, density) + tKey(t);
export const baseOfKey = (key: string) => key.split("|")[0];

/** Template-space path to draw/arrange; tiled patterns extend past the artboard when transformed. */
export function gridPathOf(templateId: string, density: number, t: GridTransform = IDENTITY) {
  const tpl = getTemplate(templateId);
  return tpl.tiles && !isIdentity(t) ? tpl.path(density, coverDomain(t)) : tpl.path(density);
}

/** Inverse of `gridKeyOf`: every key fully describes its grid, so any key can be rebuilt. */
export function specFromKey(key: string): { templateId: string; density: number; t: GridTransform } {
  const [base, tk = ""] = key.split("|");
  const sq = /^(square)-(\d+)$/.exec(base);
  const templateId = sq ? sq[1] : base, density = sq ? +sq[2] : 16;
  const m = /^r(-?[\d.]+)s([\d.]+)x(-?[\d.]+)y(-?[\d.]+)(h?)(v?)(?:p(-?[\d.]+),(-?[\d.]+))?$/.exec(tk);
  const t: GridTransform = m
    ? { rotate: +m[1], scale: +m[2], x: +m[3], y: +m[4], flipX: !!m[5], flipY: !!m[6], tiltX: m[7] ? +m[7] : 0, tiltY: m[8] ? +m[8] : 0 }
    : IDENTITY;
  return { templateId, density, t };
}
