import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AIPanel } from "@/components/AIPanel";
import { Canvas } from "@/components/Canvas";
import { Sidebar } from "@/components/Sidebar";
import { currentGridKey, transformOf, useEditor } from "@/store/editor";
import { useNotice } from "@/store/notice";
import { canvasApi } from "@/lib/canvas-api";
import { loadRegions } from "@/lib/regions";

export default function App() {
  const showAI = useEditor((s) => s.showAI);
  const showLibrary = useEditor((s) => s.showLibrary);
  useShortcuts();
  useEffect(() => {
    const s = useEditor.getState();
    void loadRegions(s.templateId, s.density, transformOf(s));
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-dvh gap-2 bg-background p-2">
        {showAI && <AIPanel />}
        <Canvas />
        {showLibrary && <Sidebar />}
      </div>
      <Notice />
    </TooltipProvider>
  );
}

function Notice() {
  const { text, id } = useNotice();
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center" role="status" aria-live="polite">
      <div key={id} className="animate-rise rounded-full border border-border bg-popover/95 px-4 py-2 text-[13px] shadow-xl shadow-black/30 backdrop-blur-xl">
        {text}
      </div>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      const s = useEditor.getState();
      const key = currentGridKey(s);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? s.redo(key) : s.undo(key); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); s.redo(key); return; }
      if (mod && e.key === "0") { e.preventDefault(); canvasApi.fit(); return; }
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); canvasApi.zoomBy(1.25); return; }
      if (mod && e.key === "-") { e.preventDefault(); canvasApi.zoomBy(0.8); return; }
      if (mod || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "v": case "b": s.setTool("paint"); break;
        case "h": s.setTool("pan"); break;
        case "e": s.setTool("erase"); break;
        case "p": s.togglePreview(); break;
        case "t": if (!s.tilePreview) canvasApi.revealTiles(); s.toggleTilePreview(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
