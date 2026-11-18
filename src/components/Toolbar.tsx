import { ArrowUpFromLine, Box, ChevronDown, LayoutGrid, Copy, Download, Eraser, Eye, EyeOff, FileCode2, Hand, ImageIcon, MousePointer2, Redo2, Rotate3d, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EMPTY_FILLS, INKS, useEditor, useGridKey, useHistoryState, useView, type Tool } from "@/store/editor";
import { exportDrawing } from "@/lib/export";
import { canvasApi } from "@/lib/canvas-api";
import { cn } from "@/lib/utils";

const TOOLS: { id: Tool; label: string; kbd: string; Icon: typeof Hand }[] = [
  { id: "paint", label: "Fill", kbd: "V", Icon: MousePointer2 },
  { id: "pan", label: "Pan", kbd: "H", Icon: Hand },
  { id: "orbit", label: "Orbit · tilt the canvas", kbd: "O", Icon: Rotate3d },
  { id: "extrude", label: "Extrude · drag a face up", kbd: "X", Icon: ArrowUpFromLine },
  { id: "erase", label: "Erase", kbd: "E", Icon: Eraser },
];

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

/** Figma UI3-style floating toolbar: one bar, icon buttons, hairline dividers between groups. */
const tb = "size-8 rounded-md [&_svg]:size-4";
const Divider = () => <span className="mx-1 h-5 w-px bg-border" aria-hidden />;

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const ink = useEditor((s) => s.ink);
  const preview = useEditor((s) => s.preview);
  const tiles = useEditor((s) => s.tilePreview);
  const is3D = useEditor((s) => s.view3d.enabled);
  const key = useGridKey();
  const hist = useHistoryState(key);
  const empty = useEditor((s) => !Object.keys(s.fills[key] ?? EMPTY_FILLS).length);
  const ed = useEditor.getState;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-border bg-card p-1.5 shadow-lg shadow-black/35">
        {TOOLS.map(({ id, label, kbd, Icon }) => (
          <Tip key={id} label={label} kbd={kbd}>
            <Button
              variant="ghost"
              size="icon"
              aria-pressed={tool === id}
              aria-label={label}
              onClick={() => ed().setTool(id)}
              className={cn(tb, tool === id && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground")}
            >
              <Icon />
            </Button>
          </Tip>
        ))}
        <Popover>
          <Tip label="Ink colour">
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className={tb} aria-label="Ink colour">
                <span className="size-4 rounded-full ring-1 ring-input transition-colors" style={{ background: ink }} />
              </Button>
            </PopoverTrigger>
          </Tip>
          <PopoverContent side="top" className="flex gap-1.5 p-2">
            {INKS.map((c) => (
              <button
                key={c}
                aria-label={`Ink ${c}`}
                onClick={() => ed().setInk(c)}
                className={cn("size-6 rounded-full ring-1 ring-input transition-transform hover:scale-110", c === ink && "ring-2 ring-brand ring-offset-2 ring-offset-popover")}
                style={{ background: c }}
              />
            ))}
          </PopoverContent>
        </Popover>

        <Divider />
        <Tip label="Undo" kbd={`${mod}Z`}>
          <Button variant="ghost" size="icon" className={tb} aria-label="Undo" disabled={hist[0] !== "1"} onClick={() => ed().undo(key)}><Undo2 /></Button>
        </Tip>
        <Tip label="Redo" kbd={`⇧${mod}Z`}>
          <Button variant="ghost" size="icon" className={tb} aria-label="Redo" disabled={hist[1] !== "1"} onClick={() => ed().redo(key)}><Redo2 /></Button>
        </Tip>
        <Tip label="Clear canvas">
          <Button variant="ghost" size="icon" className={tb} aria-label="Clear canvas" disabled={empty} onClick={() => ed().commit(key, {})}><Trash2 /></Button>
        </Tip>

        <Divider />
        <Tip label={preview ? "Show grid" : "Preview without grid"} kbd="P">
          <Button variant="ghost" size="icon" aria-label="Toggle preview" aria-pressed={preview} onClick={() => ed().togglePreview()} className={cn(tb, preview && "bg-accent")}>
            {preview ? <EyeOff /> : <Eye />}
          </Button>
        </Tip>
        <Tip label={tiles ? "Hide tile preview" : "Preview as repeating tiles"} kbd="T">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle tile preview"
            aria-pressed={tiles}
            onClick={() => { if (tiles) canvasApi.hideTiles(); else { ed().toggleTilePreview(); canvasApi.revealTiles(); } }}
            className={cn(tb, tiles && "bg-accent text-brand")}
          >
            <LayoutGrid />
          </Button>
        </Tip>

        <Divider />
        <Tip label="Zoom out" kbd={`${mod}−`}>
          <Button variant="ghost" size="icon" className={tb} aria-label="Zoom out" onClick={() => canvasApi.zoomBy(1 / 1.25)}><ZoomOut /></Button>
        </Tip>
        <Tip label="Fit to screen" kbd={`${mod}0`}>
          <Button variant="ghost" className="h-8 w-14 px-0 text-xs tabular-nums" onClick={() => canvasApi.fit()}><ZoomLabel /></Button>
        </Tip>
        <Tip label="Zoom in" kbd={`${mod}+`}>
          <Button variant="ghost" size="icon" className={tb} aria-label="Zoom in" onClick={() => canvasApi.zoomBy(1.25)}><ZoomIn /></Button>
        </Tip>

        <Divider />
        <div className="flex overflow-hidden rounded-md">
          <Button className="h-8 rounded-none pl-2.5 pr-3 text-xs" onClick={() => exportDrawing(is3D ? "png3d" : "svg")}>
            <Download />
            Export
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="size-8 rounded-none border-l border-white/25" aria-label="More export options"><ChevronDown /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end">
              <DropdownMenuItem onSelect={() => exportDrawing("svg")}><FileCode2 />Download SVG</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportDrawing("png")}><ImageIcon />Download PNG</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportDrawing("copy")}><Copy />Copy SVG</DropdownMenuItem>
              {is3D && <DropdownMenuItem onSelect={() => exportDrawing("png3d")}><Box />Download 3D view (PNG)</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

/** Only this label re-renders while zooming. */
function ZoomLabel() {
  const zoom = useView((s) => Math.round(s.zoom * 100));
  // On the 3D canvas, zoom is how close the camera is (100% = fitted).
  const zoom3d = useEditor((s) => (s.view3d.enabled ? Math.round(100 / s.view3d.distance) : null));
  return <>{zoom3d ?? zoom}%</>;
}
