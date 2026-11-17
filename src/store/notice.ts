import { create } from "zustand";

interface NoticeState { text: string | null; id: number }
export const useNotice = create<NoticeState>()(() => ({ text: null, id: 0 }));

let timer = 0;
export function notify(text: string) {
  window.clearTimeout(timer);
  useNotice.setState((s) => ({ text, id: s.id + 1 }));
  timer = window.setTimeout(() => useNotice.setState({ text: null }), 2400);
}
