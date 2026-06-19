import { create } from "zustand";

/**
 * Per-window state of a native chrome shell (e.g. a browser's current URL).
 * Updated by the AI content via the `chrome` syscall (s2c.chrome.set) and by
 * the chrome component's own interactions.
 */
interface ChromeStoreState {
  states: Record<string, Record<string, string>>;
  set: (windowId: string, patch: Record<string, string>) => void;
  clear: (windowId: string) => void;
}

export const useChromeStore = create<ChromeStoreState>((set) => ({
  states: {},
  set: (windowId, patch) =>
    set((s) => ({
      states: { ...s.states, [windowId]: { ...s.states[windowId], ...patch } },
    })),
  clear: (windowId) =>
    set((s) => {
      if (!s.states[windowId]) return s;
      const states = { ...s.states };
      delete states[windowId];
      return { states };
    }),
}));
