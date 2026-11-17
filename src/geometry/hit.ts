import { insideLoops, segBBox, type FaceGeom, type Loop } from "./seg";

/** Uniform bucket grid over the artboard for O(1)-ish point → face lookups. */
export class HitIndex {
  private buckets: number[][];
  private readonly n = 32;
  constructor(private faces: { loops: Loop[]; bbox: [number, number, number, number] }[], private size: number) {
    this.buckets = Array.from({ length: this.n * this.n }, () => []);
    faces.forEach((f, id) => {
      const [x0, y0, x1, y1] = f.bbox;
      const c = (v: number) => Math.min(this.n - 1, Math.max(0, Math.floor((v / size) * this.n)));
      for (let by = c(y0); by <= c(y1); by++) for (let bx = c(x0); bx <= c(x1); bx++) this.buckets[by * this.n + bx].push(id);
    });
  }
  find(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return -1;
    const b = this.buckets[Math.floor((y / this.size) * this.n) * this.n + Math.floor((x / this.size) * this.n)];
    for (const id of b) {
      const f = this.faces[id];
      const [x0, y0, x1, y1] = f.bbox;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (insideLoops(f.loops, x, y)) return id;
    }
    return -1;
  }
}

export function loopsBBox(loops: Loop[]): [number, number, number, number] {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of loops) for (const s of l) {
    const sb = segBBox(s);
    b = [Math.min(b[0], sb[0]), Math.min(b[1], sb[1]), Math.max(b[2], sb[2]), Math.max(b[3], sb[3])];
  }
  return b;
}

export type { FaceGeom };
