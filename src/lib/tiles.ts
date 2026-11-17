import { GRID_SPACE } from "./templates";

/**
 * Tile preview renderer (Canvas 2D). One tile bitmap is drawn from the artwork's
 * per-colour outlines, then the viewport is filled with a native repeating pattern that
 * follows the view transform — cheap enough to redraw every frame while zooming.
 */
type Groups = readonly (readonly [string, string])[];

let groups: Groups = [];
let tile: HTMLCanvasElement | null = null;
let tilePx = 0;
let dirty = true;
let target: HTMLCanvasElement | null = null;
let lastView = { x: 0, y: 0, s: 1, base: 640 };
let crispTimer = 0;

export function setTileArt(next: Groups) {
  groups = next;
  dirty = true;
  redraw();
}

export function attachTileCanvas(c: HTMLCanvasElement | null) {
  target = c;
  redraw();
}

function renderTile(px: number) {
  tile ??= document.createElement("canvas");
  tile.width = tile.height = px;
  const ctx = tile.getContext("2d")!;
  ctx.clearRect(0, 0, px, px);
  ctx.save();
  ctx.scale(px / GRID_SPACE, px / GRID_SPACE);
  for (const [color, d] of groups) {
    if (!d) continue;
    ctx.fillStyle = color;
    ctx.fill(new Path2D(d), "evenodd");
  }
  ctx.restore();
  tilePx = px;
  dirty = false;
}

/** Called from the canvas frame loop with the current view transform. */
export function drawTiles(x: number, y: number, s: number, base: number) {
  lastView = { x, y, s, base };
  redraw();
}

function redraw() {
  const c = target;
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!groups.length) return;

  const { x, y, s, base } = lastView;
  const want = Math.min(2048, Math.max(32, Math.round(base * s * dpr)));
  // Reuse the bitmap while zooming; re-render crisply once the view settles.
  if (dirty || !tilePx) renderTile(want);
  else if (Math.abs(want - tilePx) / tilePx > 0.08) {
    window.clearTimeout(crispTimer);
    crispTimer = window.setTimeout(() => { renderTile(want); redraw(); }, 140);
  }
  const pattern = ctx.createPattern(tile!, "repeat")!;
  const k = (base * s * dpr) / tilePx;
  pattern.setTransform(new DOMMatrix([k, 0, 0, k, x * dpr, y * dpr]));
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
}
