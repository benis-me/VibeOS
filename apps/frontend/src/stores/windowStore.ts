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
  /** The running generation: when it started and its latest progress line. */
  progress: Record<string, { since: number; status?: string }>;
  /** Why the last generation left the window unfinished (an i18n key). */
  failed: Record<string, string>;
  setAll: (windows: WindowState[], snapshots: Record<string, string>) => void;
  upsert: (w: WindowState) => void;
  remove: (id: string) => void;
  reorder: (ids: string[]) => void;
  focus: (id: string) => void;
  applyPatch: (patch: UiPatchPayload) => void;
  setBusy: (id: string, busy: boolean, status?: string) => void;
  setFailed: (id: string, reason?: string) => void;
}

export const useWindowStore = create<WindowStoreState>((set) => ({
  windows: {},
  snapshots: {},
  patches: {},
  busy: {},
  progress: {},
  failed: {},
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
      const progress = { ...s.progress };
      const failed = { ...s.failed };
      delete windows[id];
      delete snapshots[id];
      delete patches[id];
      delete busy[id];
      delete progress[id];
      delete failed[id];
      return { windows, snapshots, patches, busy, progress, failed };
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
  setBusy: (id, busy, status) =>
    set((s) => {
      const progress = { ...s.progress };
      const failed = { ...s.failed };
      if (!busy) delete progress[id];
      else if (!s.busy[id]) {
        // A new generation starts: restart the clock and drop the last failure.
        progress[id] = { since: Date.now(), status };
        delete failed[id];
      } else if (status) progress[id] = { since: progress[id]?.since ?? Date.now(), status };
      return { busy: { ...s.busy, [id]: busy }, progress, failed };
    }),
  setFailed: (id, reason) =>
    set((s) => {
      const failed = { ...s.failed };
      if (reason) failed[id] = reason;
      else delete failed[id];
      return { failed };
    }),
}));
