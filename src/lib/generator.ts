const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Grid generator: a grid is a stack of layers, each a parametric family of lines or
 * circles in the 240×240 template space (centred on 120,120). Tiled layers extend over
 * whatever domain is requested, so generated grids transform like built-in ones.
 */
export type Layer =
  | { id: string; kind: "lines"; angle: number; spacing: number; offset: number }
  | { id: string; kind: "lattice"; spacing: number; radius: number; stagger: boolean }
  | { id: string; kind: "rings"; count: number; inner: number; outer: number }
  | { id: string; kind: "spokes"; count: number; rotation: number }
  | { id: string; kind: "polygon"; sides: number; radius: number; rotation: number; nested: number }
  | { id: string; kind: "hexagons"; size: number };
export type LayerKind = Layer["kind"];

export interface CustomGridDef { id: string; name: string; layers: Layer[]; createdAt: number }

export const LAYER_INFO: Record<LayerKind, { label: string; hint: string }> = {
  lines: { label: "Parallel lines", hint: "A family of evenly spaced lines at an angle" },
  lattice: { label: "Circle lattice", hint: "Circles repeated on a square or staggered lattice" },
  rings: { label: "Concentric rings", hint: "Circles around the centre" },
  spokes: { label: "Radial spokes", hint: "Lines from the centre at equal angles" },
  polygon: { label: "Polygon", hint: "Regular polygons around the centre" },
  hexagons: { label: "Hexagons", hint: "A honeycomb tiling" },
};

export function newLayer(kind: LayerKind): Layer {
  const id = uid();
  switch (kind) {
    case "lines": return { id, kind, angle: 0, spacing: 30, offset: 0 };
    case "lattice": return { id, kind, spacing: 60, radius: 30, stagger: false };
    case "rings": return { id, kind, count: 5, inner: 24, outer: 120 };
    case "spokes": return { id, kind, count: 12, rotation: 0 };
    case "polygon": return { id, kind, sides: 6, radius: 110, rotation: 0, nested: 2 };
    case "hexagons": return { id, kind, size: 20 };
  }
}

/* ---------------- path generation ---------------- */

const S = 240, CX = 120, CY = 120;
const f = (v: number) => +v.toFixed(9);
const C = (x: number, y: number, r: number) =>
  `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
const L = (a: number, b: number, c: number, d: number) => `M${f(a)} ${f(b)}L${f(c)} ${f(d)}`;
type Domain = readonly [number, number];

function lines(l: Extract<Layer, { kind: "lines" }>, [lo, hi]: Domain) {
  const a = (l.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const corners = [[lo, lo], [hi, lo], [hi, hi], [lo, hi]].map(([x, y]) => nx * (x - CX) + ny * (y - CY));
  const cMin = Math.min(...corners), cMax = Math.max(...corners);
  const step = Math.max(2, l.spacing);
  let s = "";
  for (let k = Math.ceil((cMin - l.offset) / step); k * step + l.offset <= cMax; k++) {
    const c = k * step + l.offset;
    // Point on the line nearest the centre, then extend far along the direction; the engine clips.
    const px = CX + nx * c, py = CY + ny * c, R = (hi - lo) * 1.5;
    s += L(px - dx * R, py - dy * R, px + dx * R, py + dy * R);
  }
  return s;
}

function lattice(l: Extract<Layer, { kind: "lattice" }>, [lo, hi]: Domain) {
  const sx = Math.max(4, l.spacing), sy = l.stagger ? sx * (Math.sqrt(3) / 2) : sx;
  let s = "";
  for (let j = Math.floor((lo - l.radius - CY) / sy); CY + j * sy <= hi + l.radius; j++) {
    const shift = l.stagger && j % 2 !== 0 ? sx / 2 : 0;
    for (let i = Math.floor((lo - l.radius - CX - shift) / sx); CX + shift + i * sx <= hi + l.radius; i++)
      s += C(CX + shift + i * sx, CY + j * sy, Math.max(1, l.radius));
  }
  return s;
}

function rings(l: Extract<Layer, { kind: "rings" }>) {
  let s = "";
  const n = Math.max(1, Math.round(l.count));
  for (let i = 0; i < n; i++) {
    const r = n === 1 ? l.outer : l.inner + ((l.outer - l.inner) * i) / (n - 1);
    if (r > 0.5) s += C(CX, CY, r);
  }
  return s;
}

function spokes(l: Extract<Layer, { kind: "spokes" }>, [lo, hi]: Domain) {
  const R = Math.max(hi - CX, CX - lo) * 1.5;
  let s = "";
  const n = Math.max(1, Math.round(l.count));
  for (let i = 0; i < n; i++) {
    const a = ((l.rotation + (i * 360) / n) * Math.PI) / 180;
    s += L(CX, CY, CX + R * Math.cos(a), CY + R * Math.sin(a));
  }
  return s;
}

function polygon(l: Extract<Layer, { kind: "polygon" }>) {
  const n = Math.max(3, Math.round(l.sides)), levels = Math.max(1, Math.round(l.nested));
  let s = "";
  for (let k = 1; k <= levels; k++) {
    const r = (l.radius * k) / levels;
    for (let i = 0; i < n; i++) {
      const a = ((l.rotation - 90 + (i * 360) / n) * Math.PI) / 180;
      s += (i ? "L" : "M") + f(CX + r * Math.cos(a)) + " " + f(CY + r * Math.sin(a));
    }
    s += "Z";
  }
  return s;
}

function hexagons(l: Extract<Layer, { kind: "hexagons" }>, [lo, hi]: Domain) {
  const R = Math.max(4, l.size), h = R * Math.sqrt(3);
  let s = "";
  for (let col = Math.floor((lo - R - CX) / (1.5 * R)) - 1; CX + col * 1.5 * R < hi + R; col++)
    for (let row = Math.floor((lo - h - CY) / h) - 1; CY + row * h < hi + h; row++) {
      const cx = CX + col * 1.5 * R, cy = CY + row * h + (((col % 2) + 2) % 2 ? h / 2 : 0);
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        s += (k ? "L" : "M") + f(cx + R * Math.cos(a)) + " " + f(cy + R * Math.sin(a));
      }
      s += "Z";
    }
  return s;
}

export function generatePath(layers: Layer[], domain: Domain = [0, S]): string {
  let s = "";
  for (const l of layers) {
    switch (l.kind) {
      case "lines": s += lines(l, domain); break;
      case "lattice": s += lattice(l, domain); break;
      case "rings": s += rings(l); break;
      case "spokes": s += spokes(l, domain); break;
      case "polygon": s += polygon(l); break;
      case "hexagons": s += hexagons(l, domain); break;
    }
  }
  return s;
}

/* ---------------- randomiser ---------------- */

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
/** Spacings that divide the artboard evenly, so random grids stay balanced. */
const DIVISORS = [12, 15, 20, 24, 30, 40, 48, 60, 80];

export function randomLayers(): Layer[] {
  const recipes: (() => Layer[])[] = [
    () => { const sp = pick(DIVISORS); return [{ ...newLayer("lines"), spacing: sp } as Layer, { ...newLayer("lines"), angle: 90, spacing: sp } as Layer, { ...newLayer("lines"), angle: pick([45, 60, 30]), spacing: sp * pick([1, 2]) } as Layer]; },
    () => [{ ...newLayer("rings"), count: pick([4, 5, 6, 8]), inner: pick([0, 15, 30]), outer: 120 } as Layer, { ...newLayer("spokes"), count: pick([6, 8, 12, 16, 24]) } as Layer],
    () => { const sp = pick([40, 48, 60, 80]); return [{ ...newLayer("lattice"), spacing: sp, radius: sp * pick([0.5, 0.5, 0.75, 1]) } as Layer, { ...newLayer("lines"), spacing: sp } as Layer, { ...newLayer("lines"), angle: 90, spacing: sp } as Layer]; },
    () => [{ ...newLayer("polygon"), sides: pick([3, 4, 5, 6, 8]), nested: pick([2, 3, 4]), radius: pick([100, 115, 120]) } as Layer, { ...newLayer("rings"), count: pick([2, 3]), inner: 40, outer: 120 } as Layer, { ...newLayer("spokes"), count: pick([6, 8, 12]) } as Layer],
    () => [{ ...newLayer("hexagons"), size: pick([16, 20, 24, 30, 40]) } as Layer, { ...newLayer("rings"), count: pick([1, 2, 3]), inner: 60, outer: 120 } as Layer],
    () => { const sp = pick([30, 40, 60]); return [{ ...newLayer("lattice"), spacing: sp, radius: sp / 2, stagger: true } as Layer, { ...newLayer("lines"), angle: pick([0, 30, 60]), spacing: sp * (Math.sqrt(3) / 2) } as Layer]; },
  ];
  return pick(recipes)();
}

export const newGridDef = (name: string, layers: Layer[]): CustomGridDef => ({ id: `custom-${uid()}`, name, layers, createdAt: Date.now() });
