import { create } from "zustand";
import type { WindowState } from "@vibeos/shared";
import type { UiPatchPayload } from "@vibeos/shared/protocol";
import { applyRegions } from "@/lib/patch";

interface WindowStoreState {
  windows: Record<string, WindowState>;
  /** Per-window AI HTML snapshot (rendered content). */
  snapshots: Record<string, string>;
  patches: Record<string, UiPatchPayload>;
  /** Windows currently waiting on an AI response. */
  busy: Record<string, boolean>;
  setAll: (windows: WindowState[], snapshots: Record<string, string>) => void;
  upsert: (w: WindowState) => void;
  remove: (id: string) => void;
  reorder: (ids: string[]) => void;
  focus: (id: string) => void;
  applyPatch: (patch: UiPatchPayload) => void;
  setBusy: (id: string, busy: boolean) => void;
}

export const useWindowStore = create<WindowStoreState>((set) => ({
  windows: {},
  snapshots: {},
  patches: {},
  busy: {},
  setAll: (windows, snapshots) =>
    set(() => {
      const map: Record<string, WindowState> = {};
      for (const w of windows) map[w.id] = w;
      return { windows: map, snapshots, patches: {} };
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
      const patches = { ...s.patches };
      const busy = { ...s.busy };
      delete windows[id];
      delete snapshots[id];
      delete patches[id];
      delete busy[id];
      return { windows, snapshots, patches, busy };
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
  applyPatch: (patch) =>
    set((s) => ({
      // Keep the committed revision with the snapshot across no-op acknowledgements
      // and iframe reloads, not only in the most recent patch envelope.
      ...(!patch.streaming &&
      s.windows[patch.windowId] &&
      (patch.dataVersion !== undefined || patch.mode === "full" || patch.regions?.length)
        ? {
            windows: {
              ...s.windows,
              [patch.windowId]: {
                ...s.windows[patch.windowId]!,
                snapshotDataVersion: patch.dataVersion,
              },
            },
          }
        : {}),
      snapshots: {
        ...s.snapshots,
        [patch.windowId]:
          patch.mode === "full"
            ? (patch.html ?? s.snapshots[patch.windowId] ?? "")
            : applyRegions(s.snapshots[patch.windowId] ?? "", patch.regions ?? []),
      },
      patches: { ...s.patches, [patch.windowId]: patch },
    })),
  setBusy: (id, busy) => set((s) => ({ busy: { ...s.busy, [id]: busy } })),
}));
