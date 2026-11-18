/** Imperative handle so the toolbar and shortcuts can drive the viewport. Set by <Canvas/>. */
export const canvasApi = {
  zoomBy: (_factor: number) => {},
  fit: () => {},
  /** Ease out far enough to see the artwork repeat (about 3×3 tiles). */
  revealTiles: () => {},
  /** Reverse of `revealTiles`: ease back to the view it zoomed out from, then turn the tile preview off. */
  hideTiles: () => {},
  /** PNG of the 3D view; resolves null when the 3D canvas isn't showing. */
  snapshot3D: async (): Promise<Blob | null> => null,
};
