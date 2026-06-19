import { create } from "zustand";
import type { WindowState } from "@vibeos/shared";

interface WindowStoreState {
  windows: Record<string, WindowState>;
  /** Per-window AI HTML snapshot (rendered content). */
  snapshots: Record<string, string>;
  /** Windows currently waiting on an AI response. */
  busy: Record<string, boolean>;
  setAll: (windows: WindowState[], snapshots: Record<string, string>) => void;
  upsert: (w: WindowState) => void;
  remove: (id: string) => void;
  reorder: (ids: string[]) => void;
  focus: (id: string) => void;
  setSnapshot: (id: string, html: string) => void;
  setBusy: (id: string, busy: boolean) => void;
}

export const useWindowStore = create<WindowStoreState>((set) => ({
  windows: {},
  snapshots: {},
  busy: {},
  setAll: (windows, snapshots) =>
    set(() => {
      const map: Record<string, WindowState> = {};
      for (const w of windows) map[w.id] = w;
      return { windows: map, snapshots };
    }),
  upsert: (w) => set((s) => ({ windows: { ...s.windows, [w.id]: w } })),
  reorder: (ids) =>
    set((s) => {
      const windows = { ...s.windows };
      ids.forEach((id, i) => {
        if (windows[id]) windows[id] = { ...windows[id]!, order: i };
      });
      return { windows };
    }),
  remove: (id) =>
    set((s) => {
      const windows = { ...s.windows };
      const snapshots = { ...s.snapshots };
      const busy = { ...s.busy };
      delete windows[id];
      delete snapshots[id];
      delete busy[id];
      return { windows, snapshots, busy };
    }),
  focus: (id) =>
    set((s) => {
      const windows = { ...s.windows };
      const maxZ = Math.max(0, ...Object.values(windows).map((w) => w.z));
      for (const k of Object.keys(windows)) {
        windows[k] = { ...windows[k]!, focused: k === id };
      }
      const w = windows[id];
      if (w) {
        // Focusing always activates the window — so a minimized one is restored.
        windows[id] = {
          ...w,
          z: maxZ + 1,
          focused: true,
          state: w.state === "minimized" ? "normal" : w.state,
        };
      }
      return { windows };
    }),
  setSnapshot: (id, html) => set((s) => ({ snapshots: { ...s.snapshots, [id]: html } })),
  setBusy: (id, busy) => set((s) => ({ busy: { ...s.busy, [id]: busy } })),
}));
