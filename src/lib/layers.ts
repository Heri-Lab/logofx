import { unpackFill, type Layer } from "@/store/editor";

/** Visible layers bottom to top, each with its [colour, path] groups, from [packed fill, path] groups. */
export function stackByLayer(groups: readonly (readonly [string, string])[], layers: Layer[]) {
  const by = new Map<string, [string, string][]>();
  for (const [v, d] of groups) {
    const { layer, color } = unpackFill(v);
    // A shape whose layer no longer exists falls back to the bottom layer.
    const id = layers.some((l) => l.id === layer) ? layer : layers[0].id;
    (by.get(id) ?? by.set(id, []).get(id)!).push([color, d]);
  }
  return layers.filter((l) => l.visible && by.has(l.id)).map((layer) => ({ layer, groups: by.get(layer.id)! }));
}
