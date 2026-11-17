import type { Seg } from "./seg";

/**
 * Parses the SVG path subset our grid templates use (M L H V A Z, absolute and
 * relative) into exact line and circular-arc segments.
 */
export function parsePath(d: string): Seg[] {
  const tokens = d.match(/[MLHVAZmlhvaz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const segs: Seg[] = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0;
  const num = () => parseFloat(tokens[i++]);
  const line = (x1: number, y1: number) => {
    if (Math.hypot(x1 - x, y1 - y) > 1e-9) segs.push({ k: 0, x0: x, y0: y, x1, y1 });
    x = x1; y = y1;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
        x = sx = nx; y = sy = ny;
        cmd = rel ? "l" : "L"; // implicit lineto after the first pair
        break;
      }
      case "L": { const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0); line(nx, ny); break; }
      case "H": line(num() + (rel ? x : 0), y); break;
      case "V": line(x, num() + (rel ? y : 0)); break;
      case "Z": line(sx, sy); break;
      case "A": {
        const rx = num(); num(); num(); // ry, rotation — templates only use circles
        const large = num(), sweep = num();
        const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
        const arc = endpointArc(x, y, nx, ny, rx, large === 1, sweep === 1);
        if (arc) segs.push(arc);
        x = nx; y = ny;
        break;
      }
      default: i++;
    }
  }
  return segs;
}

/** SVG endpoint arc (circle, no rotation) → centre parameterisation. */
function endpointArc(x0: number, y0: number, x1: number, y1: number, r: number, large: boolean, sweep: boolean): Seg | null {
  if (Math.hypot(x1 - x0, y1 - y0) < 1e-9 || r <= 0) return null;
  const hx = (x0 - x1) / 2, hy = (y0 - y1) / 2;
  const lambda = (hx * hx + hy * hy) / (r * r);
  if (lambda > 1) r *= Math.sqrt(lambda);
  const num = r * r * r * r - r * r * hy * hy - r * r * hx * hx;
  const den = r * r * hy * hy + r * r * hx * hx;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * hy, cyp = -coef * hx;
  const cx = cxp + (x0 + x1) / 2, cy = cyp + (y0 + y1) / 2;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  let da = Math.atan2(y1 - cy, x1 - cx) - a0;
  if (sweep && da < 0) da += Math.PI * 2;
  if (!sweep && da > 0) da -= Math.PI * 2;
  // Half circles land exactly on ±π; keep the sign the sweep flag asks for.
  if (Math.abs(Math.abs(da) - Math.PI) < 1e-12) da = sweep ? Math.PI : -Math.PI;
  return { k: 1, cx, cy, r, a0, da };
}
