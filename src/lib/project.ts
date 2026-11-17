import { parsePath } from "@/geometry/parse";
import { apply, inv } from "@/geometry/mat3";
import { projectSegs, segsToPath, transformSegs, type Seg } from "@/geometry/seg";
import { GRID_SPACE, gridPathOf, hasPerspective, homography, isIdentity, transformMatrix, type GridTransform } from "./templates";

/** Grid geometry in artboard space for a template-space path and transform. */
export function segsForPath(path: string, t: GridTransform): Seg[] {
  const segs = parsePath(path);
  if (isIdentity(t)) return segs;
  if (hasPerspective(t)) {
    const H = homography(t);
    const Hi = inv(H);
    const m = 2; // pad so border shapes close cleanly
    const pre = ([[-m, -m], [GRID_SPACE + m, -m], [GRID_SPACE + m, GRID_SPACE + m], [-m, GRID_SPACE + m]] as const).map(([x, y]) => apply(Hi, x, y));
    return projectSegs(segs, H, pre);
  }
  return transformSegs(segs, transformMatrix(t), t);
}

const lineCache = new Map<string, string>();
/** Artboard-space SVG path of the grid lines under a perspective transform (cached). */
export function projectedGridPath(templateId: string, density: number, t: GridTransform): string {
  const k = `${templateId}|${density}|${JSON.stringify(t)}`;
  let d = lineCache.get(k);
  if (d === undefined) {
    d = segsToPath(segsForPath(gridPathOf(templateId, density, t), t));
    lineCache.set(k, d);
    if (lineCache.size > 16) lineCache.delete(lineCache.keys().next().value!);
  }
  return d;
}
