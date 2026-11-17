import { create } from "zustand";
import { persist } from "zustand/middleware";
import { generateConcepts, type Concept, type Style } from "@/lib/shapes";
import { uid } from "@/lib/utils";

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  concepts?: Concept[];
  selected?: number | null;
}
export interface Chat { id: string; title: string; createdAt: number; messages: Message[] }

interface ChatState {
  chats: Chat[];
  activeId: string;
  credits: number;
  style: Style;
  pending: boolean;
  /** Id of the assistant message currently being "typed". Not persisted. */
  streamingId: string | null;
  setStyle: (s: Style) => void;
  newChat: () => void;
  openChat: (id: string) => void;
  send: (text: string, gridName: string) => void;
  regenerate: (messageId: string) => void;
  select: (messageId: string, index: number) => void;
  finishStreaming: () => void;
}

const seedChat = (): Chat => ({
  id: uid(),
  title: "Fox head from circles",
  createdAt: Date.now(),
  messages: [
    { id: uid(), role: "user", text: "A fox head built from circles, geometric, fits the 16×16 grid" },
    {
      id: uid(),
      role: "assistant",
      text: "Here are 3 concepts built from your grid’s shapes. Pick one to place it on the canvas, then edit any shape.",
      concepts: [
        { shape: "circle", params: { hole: 0, eyes: true } },
        { shape: "fox", params: { hole: 0, eyes: true } },
        { shape: "badge", params: { hole: 0.1, eyes: false } },
      ],
      selected: null,
    },
  ],
});

const first = seedChat();
const patchActive = (s: ChatState, fn: (c: Chat) => Chat) => ({
  chats: s.chats.map((c) => (c.id === s.activeId ? fn(c) : c)),
});

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      chats: [first],
      activeId: first.id,
      credits: 5,
      style: "Geometric",
      pending: false,
      streamingId: null,
      setStyle: (style) => set({ style }),
      newChat: () => {
        const cur = get().chats.find((c) => c.id === get().activeId);
        if (cur && cur.messages.length === 0) return;
        const chat: Chat = { id: uid(), title: "New chat", createdAt: Date.now(), messages: [] };
        set((s) => ({ chats: [chat, ...s.chats], activeId: chat.id }));
      },
      openChat: (activeId) => set({ activeId }),
      send: (text, gridName) => {
        const t = text.trim();
        const s = get();
        if (!t || s.pending || s.credits <= 0) return;
        set((st) => ({
          pending: true,
          ...patchActive(st, (c) => ({
            ...c,
            title: c.messages.length ? c.title : t.length > 38 ? t.slice(0, 36) + "…" : t,
            messages: [...c.messages, { id: uid(), role: "user", text: t }],
          })),
        }));
        // Simulated model latency; swap for a real API call later.
        window.setTimeout(() => {
          const msg: Message = {
            id: uid(),
            role: "assistant",
            text: `${get().style} take on “${t}”, built only from the ${gridName} grid’s shapes. Click a concept to place it.`,
            concepts: generateConcepts(get().style),
            selected: null,
          };
          set((st) => ({
            pending: false,
            credits: st.credits - 1,
            streamingId: msg.id,
            ...patchActive(st, (c) => ({ ...c, messages: [...c.messages, msg] })),
          }));
        }, 900);
      },
      regenerate: (messageId) =>
        set((st) =>
          patchActive(st, (c) => ({
            ...c,
            messages: c.messages.map((m) => (m.id === messageId ? { ...m, concepts: generateConcepts(st.style), selected: null } : m)),
          })),
        ),
      select: (messageId, index) =>
        set((st) => patchActive(st, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, selected: index } : m)) }))),
      finishStreaming: () => set({ streamingId: null }),
    }),
    {
      name: "logofx.chat.v1",
      partialize: (s) => ({ chats: s.chats, activeId: s.activeId, credits: s.credits, style: s.style }),
    },
  ),
);
