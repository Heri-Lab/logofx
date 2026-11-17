import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, CornerDownRight, Grid3x3, History, Plus, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useChat, type Message } from "@/store/chat";
import { useEditor, useGridKey, useTransform, useView } from "@/store/editor";
import { conceptRegions, useConceptRegions, useRegions } from "@/lib/regions";
import { getTemplate } from "@/lib/templates";
import { STYLES, type Concept } from "@/lib/shapes";
import { cn } from "@/lib/utils";

const SUGGESTIONS = ["Make it bolder with thicker shapes", "Try a monogram with the letters LF", "A mascot badge for a coffee shop"];

export function AIPanel() {
  const chats = useChat((s) => s.chats);
  const activeId = useChat((s) => s.activeId);
  const credits = useChat((s) => s.credits);
  const pending = useChat((s) => s.pending);
  const chat = chats.find((c) => c.id === activeId) ?? chats[0];
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const templateId = useEditor((s) => s.templateId);
  const density = useEditor((s) => s.density);
  const t = getTemplate(templateId);
  const gridName = t.usesDensity ? `${density}×${density} square` : t.name.toLowerCase();

  // Keep the thread pinned to the bottom unless the user scrolled up.
  const onScroll = () => {
    const el = scrollRef.current!;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  const scrollToEnd = (smooth = true) => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };
  useLayoutEffect(() => { pinned.current = true; scrollToEnd(false); }, [activeId]);
  useEffect(() => { scrollToEnd(); }, [chat?.messages.length, pending]);

  const send = (text = draft) => {
    if (!text.trim()) return;
    pinned.current = true;
    useChat.getState().send(text, gridName);
    setDraft("");
  };
  const refine = () => {
    setDraft("Refine: ");
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };

  // Auto-grow the composer.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }, [draft]);

  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center gap-1 px-4 py-3">
        <ChatHistory />
        <Tip label="New chat">
          <Button variant="ghost" size="icon-sm" aria-label="New chat" className="text-muted-foreground" onClick={() => { useChat.getState().newChat(); inputRef.current?.focus(); }}>
            <Plus />
          </Button>
        </Tip>
        <span className="ml-2 truncate text-[13px] font-medium text-foreground/90">{chat?.title}</span>
        <span className={cn("ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground", credits <= 1 && "text-destructive")}>{credits} credits</span>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="scroll-area min-h-0 flex-1 px-5 pb-6 pt-1">
        {!chat?.messages.length ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 grid size-9 place-items-center rounded-lg bg-brand/10 text-brand"><Sparkles className="size-4" /></div>
            <p className="text-sm font-medium">Describe a logo</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Concepts are built only from the shapes of the {gridName} grid, so every piece stays editable.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {chat.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex animate-rise justify-end">
                  <p className="max-w-[86%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2.5 text-[13px] leading-[1.45]">{m.text}</p>
                </div>
              ) : (
                <AssistantMessage key={m.id} message={m} onRefine={refine} onLayout={() => scrollToEnd()} />
              ),
            )}
            {pending && (
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Sparkles className="size-3.5 animate-pulse text-brand" />
                <span className="animate-shimmer bg-clip-text">Composing shapes on your grid…</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 px-4 pb-4">
        {(chat?.messages.length ?? 0) < 4 && (
          <div className="flex flex-col">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={pending || credits <= 0} className="flex items-center gap-2 rounded-sm px-1 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40">
                <CornerDownRight className="size-3 shrink-0" />
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3 rounded-lg border border-input bg-background p-3 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            placeholder={credits > 0 ? "Describe a logo, or ask to refine the canvas…" : "You’re out of credits"}
            disabled={credits <= 0}
            className="scroll-area resize-none bg-transparent text-[13px] leading-[1.45] outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between">
            <StylePicker />
            <Button size="icon-sm" aria-label="Send" disabled={!draft.trim() || pending || credits <= 0} onClick={() => send()}>
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function StylePicker() {
  const style = useChat((s) => s.style);
  return (
    <div className="flex gap-0.5" role="radiogroup" aria-label="Style">
      {STYLES.map((s) => (
        <button
          key={s}
          role="radio"
          aria-checked={s === style}
          onClick={() => useChat.getState().setStyle(s)}
          className={cn("rounded-sm px-1.5 py-1 text-[11px] font-medium transition-colors", s === style ? "bg-brand/10 text-brand" : "text-muted-foreground hover:text-foreground")}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function ChatHistory() {
  const chats = useChat((s) => s.chats);
  const activeId = useChat((s) => s.activeId);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ago = (ts: number) => {
    const m = Math.round((ts - Date.now()) / 60000);
    if (m > -60) return fmt.format(m, "minute");
    if (m > -1440) return fmt.format(Math.round(m / 60), "hour");
    return fmt.format(Math.round(m / 1440), "day");
  };
  return (
    <Popover>
      <Tip label="Past chats">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Past chats" className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
            <History />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="start" className="w-72">
        <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">Recent chats</p>
        <div className="scroll-area max-h-72">
          {chats.map((c) => (
            <PopoverClose asChild key={c.id}>
              <button
                onClick={() => useChat.getState().openChat(c.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{ago(c.createdAt)}</span>
                <Check className={cn("size-3.5 shrink-0 text-brand", c.id !== activeId && "invisible")} />
              </button>
            </PopoverClose>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Reveals the assistant reply progressively, then shows the concepts. */
function AssistantMessage({ message: m, onRefine, onLayout }: { message: Message; onRefine: () => void; onLayout: () => void }) {
  const streaming = useChat((s) => s.streamingId === m.id);
  const [shown, setShown] = useState(streaming ? 0 : m.text.length);
  const layout = useRef(onLayout);
  layout.current = onLayout;
  useEffect(() => {
    if (!streaming) { setShown(m.text.length); return; }
    let raf = 0, last = performance.now(), n = 0;
    const tick = (now: number) => {
      n = Math.min(m.text.length, n + ((now - last) / 1000) * 140);
      last = now;
      setShown(Math.floor(n));
      if (n < m.text.length) raf = requestAnimationFrame(tick);
      else { useChat.getState().finishStreaming(); requestAnimationFrame(() => layout.current()); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [streaming, m.text]);
  const done = shown >= m.text.length;
  const key = useGridKey();
  const ink = useEditor((s) => s.ink);

  const place = async (index: number) => {
    const concept = m.concepts?.[index];
    if (!concept) return;
    const ids = await conceptRegions(key, concept);
    useChat.getState().select(m.id, index);
    useEditor.getState().commit(key, Object.fromEntries(ids.map((i) => [i, ink])));
    useView.getState().setGhost(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-normal text-muted-foreground">
        {m.text.slice(0, shown)}
        {!done && <span className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-muted-foreground" />}
      </p>
      {done && m.concepts && (
        <>
          <div className="grid grid-cols-3 gap-1">
            {m.concepts.map((c, i) => (
              <ConceptThumb key={`${i}-${c.shape}-${c.params.hole}`} concept={c} index={i} selected={m.selected === i} onPick={() => place(i)} />
            ))}
          </div>
          <div className="flex animate-rise gap-3.5 text-[11px] font-medium text-muted-foreground [animation-delay:180ms]">
            <button className="flex items-center gap-1.5 transition-colors hover:text-foreground" onClick={() => useChat.getState().regenerate(m.id)}><RefreshCw className="size-3" />Regenerate</button>
            <button className="flex items-center gap-1.5 transition-colors hover:text-foreground" onClick={onRefine}><WandSparkles className="size-3" />Refine</button>
            <button className="flex items-center gap-1.5 transition-colors hover:text-foreground" onClick={() => place(m.selected ?? 0)}><Grid3x3 className="size-3" />Fit to grid</button>
          </div>
        </>
      )}
    </div>
  );
}

const ConceptThumb = memo(function ConceptThumb({ concept, index, selected, onPick }: { concept: Concept; index: number; selected: boolean; onPick: () => void }) {
  const templateId = useEditor((s) => s.templateId);
  const density = useEditor((s) => s.density);
  const t = useTransform();
  const { regions } = useRegions(templateId, density, t);
  const ids = useConceptRegions(regions?.key, concept);
  const d = ids && regions ? ids.map((i) => regions.paths[i]).join("") : "";
  const showGhost = () => regions && ids && useView.getState().setGhost({ key: regions.key, ids });
  const clearGhost = () => useView.getState().setGhost(null);

  return (
    <button
      onClick={onPick}
      onPointerEnter={showGhost}
      onPointerLeave={clearGhost}
      onFocus={showGhost}
      onBlur={clearGhost}
      style={{ animationDelay: `${index * 60}ms` }}
      aria-label={`Place concept ${index + 1}`}
      className={cn(
        "group grid h-20 animate-rise place-items-center rounded-lg outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50",
        selected && "bg-muted hover:bg-muted",
      )}
    >
      {d ? (
        <svg viewBox={`0 0 ${regions!.res} ${regions!.res}`} className="size-[54px] transition-transform duration-200 group-hover:scale-105" aria-hidden>
          <path d={d} fillRule="evenodd" fill="var(--foreground)" stroke="var(--foreground)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className="size-[54px] animate-shimmer rounded-md bg-muted/40" />
      )}
    </button>
  );
});
