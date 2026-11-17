/** Imperative handle so the toolbar and shortcuts can drive the viewport. Set by <Canvas/>. */
export const canvasApi = {
  zoomBy: (_factor: number) => {},
  fit: () => {},
  /** Ease out far enough to see the artwork repeat (about 3×3 tiles). */
  revealTiles: () => {},
};
