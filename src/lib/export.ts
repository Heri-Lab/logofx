import { currentGridKey, transformOf, useEditor } from "@/store/editor";
import { notify } from "@/store/notice";
import { loadRegions, traceUnion } from "./regions";
import { GRID_SPACE, gridPathOf, hasPerspective, transformMatrix } from "./templates";
import { projectedGridPath } from "./project";

export type ExportKind = "svg" | "png" | "copy";
const OUT = 1024;

async function buildSvg() {
  const s = useEditor.getState();
  const t = transformOf(s);
  const key = currentGridKey(s);
  const fills = s.fills[key] ?? {};
  const entries = Object.entries(fills);
  if (!entries.length) return null;
  if (!(await loadRegions(s.templateId, s.density, t))) return null;

  const byColor = new Map<string, number[]>();
  for (const [id, c] of entries) {
    const arr = byColor.get(c) ?? [];
    arr.push(+id);
    byColor.set(c, arr);
  }
  const colors = [...byColor.keys()];
  const { paths } = await traceUnion(key, colors.map((c) => byColor.get(c)!));
  const res = GRID_SPACE;
  const shapes = paths.map((d, i) => `<path d="${d}" fill="${colors[i]}" fill-rule="evenodd"/>`).join("");
  const guides = s.guidesOnExport
    ? `<defs><clipPath id="artboard"><rect width="${res}" height="${res}"/></clipPath></defs><g clip-path="url(#artboard)"><path d="${hasPerspective(t) ? projectedGridPath(s.templateId, s.density, t) : gridPathOf(s.templateId, s.density, t)}"${hasPerspective(t) ? "" : ` transform="matrix(${transformMatrix(t).join(" ")})"`} fill="none" stroke="${s.lineColor}" stroke-opacity="${Math.max(0.04, s.lineOpacity / 100)}" stroke-width="${res / OUT}" vector-effect="non-scaling-stroke"/></g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${res} ${res}" width="${OUT}" height="${OUT}">${shapes}${guides}</svg>`;
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function exportDrawing(kind: ExportKind) {
  const svg = await buildSvg();
  if (!svg) return notify("Nothing to export yet — fill a few shapes first.");
  if (kind === "copy") {
    await navigator.clipboard.writeText(svg);
    return notify("SVG copied to clipboard");
  }
  if (kind === "svg") {
    download(new Blob([svg], { type: "image/svg+xml" }), "logo.svg");
    return notify("Exported logo.svg");
  }
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = OUT * 2;
  canvas.getContext("2d")!.drawImage(img, 0, 0, OUT * 2, OUT * 2);
  canvas.toBlob((b) => b && download(b, "logo.png"), "image/png");
  notify("Exported logo.png · 2048×2048");
}
