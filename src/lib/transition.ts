import { remapFills, type RegionSet } from "./regions";
import { baseOfKey } from "./templates";
import { useEditor, type Fills } from "@/store/editor";

/**
 * Carries the drawing across grid transforms.
 *
 * Every step remaps from a fixed reference (the drawing as the user last edited it),
 * never from the previous intermediate step — so dragging a slider out and back loses
 * nothing, even shapes that were temporarily pushed off the artboard. If the current
 * transform has no drawing but another transform of the same grid does (e.g. the page was
 * reloaded mid-change), that drawing is adopted.
 */
let source: { key: string; fills: Fills } | null = null;
let written: { key: string; fills: Fills | undefined } | null = null;
const filled = (f?: Fills) => !!f && Object.keys(f).length > 0;

export async function carryFills(prev: RegionSet | null, next: RegionSet) {
  const base = baseOfKey(next.key);
  const all = useEditor.getState().fills;

  let fromKey: string | null = prev && baseOfKey(prev.key) === base ? prev.key : null;
  if (!fromKey) source = written = null;
  if (!filled(fromKey ? all[fromKey] : undefined) && !filled(all[next.key])) {
    fromKey = Object.keys(all).find((k) => k !== next.key && baseOfKey(k) === base && filled(all[k])) ?? fromKey;
  }
  if (!fromKey || fromKey === next.key) return;

  const cur = all[fromKey];
  const editedSinceCarry = !written || written.key !== fromKey || written.fills !== cur;
  if (editedSinceCarry || !source || baseOfKey(source.key) !== base) source = { key: fromKey, fills: cur ?? {} };

  let fills: Fills;
  try {
    if (!filled(source.fills)) fills = {};
    else if (source.key === next.key) fills = source.fills;
    else fills = await remapFills(source.key, next.key, source.fills);
  } catch (err) {
    console.warn("[logofx] could not carry drawing to transformed grid:", err);
    return;
  }

  // The user painted while we were remapping: keep their edit, the next switch picks it up.
  if (useEditor.getState().fills[fromKey] !== cur) return;
  useEditor.getState().moveFills(fromKey, next.key, fills);
  written = { key: next.key, fills: useEditor.getState().fills[next.key] };
}
