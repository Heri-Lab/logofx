import { useState } from "react";
import {
  ArrowDownToLine, Box, Copy, Download, Eye, EyeOff, FileCode2, Grid3x3, ImageIcon, Layers, LayoutGrid, Lock, LockOpen,
  Maximize, Minus, MousePointerClick, PaintBucket, Plus, Redo2, RotateCcw, Square, Trash2, Undo2, Video,
} from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent,
  ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/popover";
import { BUILTIN_CAMERAS, EMPTY_FILLS, activeFill, currentGridKey, editableLayer, layer3d, packFill, unpackFill, useEditor, useView } from "@/store/editor";
import { commitFaceDepth, editShapes } from "@/lib/faces";
import { canvasApi } from "@/lib/canvas-api";
import { exportDrawing } from "@/lib/export";
import { notify } from "@/store/notice";

/** What was under the pointer when the menu opened: a filled face, an empty shape, or nothing. */
export type MenuTarget = { key: string; ids: number[] } | null;

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";
const shift = isMac ? "⇧" : "Shift+";

/**
 * Right-click menu for the canvas, flat or tilted. `resolve` reports what is under the pointer
 * at the moment the menu opens, so the menu offers actions for that face (or shape) first and
 * canvas-wide actions after.
 */
export function CanvasMenu({ resolve, children }: { resolve: (clientX: number, clientY: number) => MenuTarget; children: React.ReactNode }) {
  const [target, setTarget] = useState<MenuTarget>(null);
  return (
    <ContextMenu modal={false} onOpenChange={(open) => !open && useView.getState().setGhost(null)}>
      <ContextMenuTrigger asChild onContextMenu={(e) => setTarget(resolve(e.clientX, e.clientY))}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuItems target={target} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MenuItems({ target }: { target: MenuTarget }) {
  const st = useEditor.getState();
  const is3D = st.view3d.enabled;
  const fills = target ? st.fills[target.key] ?? EMPTY_FILLS : EMPTY_FILLS;
  const value = target ? fills[target.ids[0]] : undefined;
  return (
    <>
      {target && value !== undefined && <FaceItems target={target} value={value} is3D={is3D} />}
      {target && value === undefined && !is3D && (
        <>
          <ContextMenuItem onSelect={() => fillShape(target)} shortcut="V">
            <PaintBucket />
            Fill shape
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <CanvasItems is3D={is3D} />
    </>
  );
}

const fillShape = (t: NonNullable<MenuTarget>) => {
  const ed = useEditor.getState();
  const layer = ed.layers.find((l) => l.id === ed.activeLayer);
  if (layer && !editableLayer(ed.layers, layer.id)) return notify(`“${layer.name}” is ${layer.locked ? "locked" : "hidden"}.`);
  ed.commit(t.key, { ...(ed.fills[t.key] ?? EMPTY_FILLS), [t.ids[0]]: activeFill(ed) });
};

function FaceItems({ target, value, is3D }: { target: NonNullable<MenuTarget>; value: string; is3D: boolean }) {
  const st = useEditor.getState();
  const f = unpackFill(value);
  const layer = st.layers.find((l) => l.id === f.layer) ?? st.layers[0];
  const depth = f.depth ?? layer3d(layer).extrude;
  const editable = editableLayer(st.layers, layer.id);
  const n = target.ids.length;
  const { key, ids } = target;
  const setDepth = (d: number | null) => commitFaceDepth(key, ids, d === null ? null : Math.min(120, Math.max(0, d)));
  return (
    <>
      <ContextMenuLabel>
        <span className="size-2.5 rounded-[2px] ring-1 ring-inset ring-white/25" style={{ background: f.color }} />
        Face · {n} shape{n === 1 ? "" : "s"} · {layer.name}
        {!editable && <Lock className="size-3" />}
      </ContextMenuLabel>
      {is3D && (
        <>
          <ContextMenuItem
            disabled={!editable}
            onSelect={() => { useView.getState().setFace({ key, ids }); st.selectLayer(layer.id); st.setTool("extrude"); }}
            shortcut="X"
          >
            <MousePointerClick />
            Select to extrude
          </ContextMenuItem>
          <ContextMenuItem disabled={!editable || depth >= 120} onSelect={() => setDepth(depth + 4)}>
            <Plus />
            Raise 4 px
            <span className="ml-auto pl-4 text-[10px] opacity-60 tabular-nums">{depth} px</span>
          </ContextMenuItem>
          <ContextMenuItem disabled={!editable || depth <= 0} onSelect={() => setDepth(depth - 4)}>
            <Minus />
            Lower 4 px
          </ContextMenuItem>
          <ContextMenuItem disabled={!editable || depth === 0} onSelect={() => setDepth(0)}>
            <ArrowDownToLine />
            Flatten
          </ContextMenuItem>
          {f.depth !== undefined && (
            <ContextMenuItem disabled={!editable} onSelect={() => setDepth(null)}>
              <RotateCcw />
              Use layer depth ({layer3d(layer).extrude} px)
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem disabled={!editable || f.color === st.ink} onSelect={() => editShapes(key, ids, () => packFill(layer.id, st.ink, f.depth))}>
        <span className="size-3.5 rounded-full ring-1 ring-inset ring-white/25" style={{ background: st.ink }} />
        Recolour with ink
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={!editable}>
          <Layers />
          Move to layer
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {[...st.layers].reverse().map((l) => (
            <ContextMenuItem
              key={l.id}
              disabled={l.id === layer.id || !editableLayer(st.layers, l.id)}
              onSelect={() => { editShapes(key, ids, () => packFill(l.id, f.color, f.depth)); st.selectLayer(l.id); }}
            >
              {l.id === layer.id ? <Square className="fill-current" /> : <Square />}
              {l.name}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              st.addLayer();
              const id = useEditor.getState().activeLayer;
              editShapes(key, ids, () => packFill(id, f.color, f.depth));
            }}
          >
            <Plus />
            New layer
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => { st.selectLayer(layer.id); st.setPanelTab("layers"); }}>
        <Layers />
        Select layer
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => st.updateLayer(layer.id, { visible: !layer.visible })}>
        {layer.visible ? <EyeOff /> : <Eye />}
        {layer.visible ? "Hide layer" : "Show layer"}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => st.updateLayer(layer.id, { locked: !layer.locked })}>
        {layer.locked ? <LockOpen /> : <Lock />}
        {layer.locked ? "Unlock layer" : "Lock layer"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!editable} onSelect={() => { editShapes(key, ids, () => null); useView.getState().setFace(null); }} shortcut="⌫" className="data-[highlighted]:bg-destructive">
        <Trash2 />
        Delete face
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}

function CanvasItems({ is3D }: { is3D: boolean }) {
  const st = useEditor.getState();
  const gridKey = currentGridKey(st);
  const h = st.history[gridKey];
  const cams = [...BUILTIN_CAMERAS, ...st.cameras];
  return (
    <>
      <ContextMenuItem disabled={!h?.past.length} onSelect={() => st.undo(gridKey)} shortcut={`${mod}Z`}>
        <Undo2 />
        Undo
      </ContextMenuItem>
      <ContextMenuItem disabled={!h?.future.length} onSelect={() => st.redo(gridKey)} shortcut={`${shift}${mod}Z`}>
        <Redo2 />
        Redo
      </ContextMenuItem>
      <ContextMenuSeparator />
      {is3D ? (
        <>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Video />
              Camera
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {cams.map((c, i) => (
                <ContextMenuItem key={c.id} onSelect={() => st.applyCamera(c.id)} shortcut={i < 9 ? String(i + 1) : undefined}>
                  {st.view3d.cameraId === c.id ? <Square className="fill-current" /> : <Square />}
                  {c.name}
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => { st.saveCamera(); notify("Saved the current view as a camera"); }}>
                <Plus />
                Save current view
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={() => st.applyCamera(st.view3d.cameraId ?? "persp")}>
            <RotateCcw />
            Reset view
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => st.set3D({ enabled: false })}>
            <Square />
            Back to 2D
          </ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuItem onSelect={() => st.togglePreview()} shortcut="P">
            <Grid3x3 />
            {st.preview ? "Show grid" : "Hide grid"}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => { if (st.tilePreview) canvasApi.hideTiles(); else { st.toggleTilePreview(); canvasApi.revealTiles(); } }}
            shortcut="T"
          >
            <LayoutGrid />
            {st.tilePreview ? "Hide tile preview" : "Tile preview"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => st.set3D({ enabled: true })} shortcut="O">
            <Box />
            Tilt into 3D
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem onSelect={() => canvasApi.fit()} shortcut={`${mod}0`}>
        <Maximize />
        Zoom to fit
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Download />
          Export
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {is3D && (
            <ContextMenuItem onSelect={() => exportDrawing("png3d")}>
              <Box />
              3D view (PNG)
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => exportDrawing("svg")}>
            <FileCode2 />
            SVG
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => exportDrawing("png")}>
            <ImageIcon />
            PNG
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => exportDrawing("copy")}>
            <Copy />
            Copy SVG
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem
        disabled={!Object.keys(st.fills[gridKey] ?? EMPTY_FILLS).length}
        onSelect={() => st.commit(gridKey, {})}
        className="data-[highlighted]:bg-destructive"
      >
        <Trash2 />
        Clear canvas
      </ContextMenuItem>
    </>
  );
}
