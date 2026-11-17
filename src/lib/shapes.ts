/** Procedural logo concepts, evaluated in normalised space u,v ∈ [-0.5, 0.5]. */
export interface ConceptParams { hole: number; eyes: boolean }
export type ShapeId = "circle" | "fox" | "badge" | "monogram" | "diamond";
export interface Concept { shape: ShapeId; params: ConceptParams }

type ShapeFn = (u: number, v: number, p: ConceptParams) => boolean;

export const SHAPES: Record<ShapeId, ShapeFn> = {
  circle: (u, v, p) => {
    const d = Math.hypot(u, v);
    const eye = p.eyes && Math.hypot(Math.abs(u) - 0.15, v + 0.05) < 0.07;
    return d < 0.44 && d > p.hole && !eye;
  },
  fox: (u, v, p) => {
    const au = Math.abs(u);
    const head = v >= -0.16 && v < 0.42 && au < (0.43 * (0.42 - v)) / 0.58;
    const t = (v + 0.46) / 0.3;
    const ear = t >= 0 && t <= 1 && au > 0.36 - 0.24 * t && au < 0.36 + 0.07 * t;
    const eye = p.eyes && Math.abs(au - 0.15) < 0.05 && Math.abs(v) < 0.05;
    return (head || ear) && !eye;
  },
  badge: (u, v, p) => {
    const d = Math.hypot(u, v);
    return (d < 0.47 && d > 0.38) || Math.abs(u) + Math.abs(v - 0.02) < 0.26 + p.hole * 0.2;
  },
  monogram: (u, v) => {
    const bar = Math.abs(u + 0.22) < 0.07 && Math.abs(v) < 0.38;
    const foot = Math.abs(v - 0.31) < 0.07 && u > -0.29 && u < 0.05;
    const stem = Math.abs(u - 0.12) < 0.07 && Math.abs(v) < 0.38;
    const top = Math.abs(v + 0.31) < 0.07 && u > 0.05 && u < 0.36;
    const mid = Math.abs(v) < 0.06 && u > 0.05 && u < 0.3;
    return bar || foot || stem || top || mid;
  },
  diamond: (u, v, p) => {
    const d = Math.abs(u) + Math.abs(v);
    return d < 0.46 && (d > 0.3 || d < 0.12 + p.hole * 0.3);
  },
};

export const STYLES = ["Geometric", "Monogram", "Mascot"] as const;
export type Style = (typeof STYLES)[number];

const POOLS: Record<Style, ShapeId[]> = {
  Geometric: ["circle", "fox", "diamond", "badge"],
  Monogram: ["monogram", "badge", "diamond"],
  Mascot: ["fox", "circle", "badge"],
};

export function generateConcepts(style: Style, count = 3): Concept[] {
  const pool = [...POOLS[style]].sort(() => Math.random() - 0.5);
  return pool.slice(0, count).map((shape) => ({
    shape,
    params: { hole: +(Math.random() * 0.2).toFixed(3), eyes: Math.random() > 0.3 },
  }));
}

export const conceptKey = (c: Concept) => `${c.shape}:${c.params.hole}:${c.params.eyes ? 1 : 0}`;
