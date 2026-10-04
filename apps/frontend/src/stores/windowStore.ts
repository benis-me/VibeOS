import { create } from "zustand";
import type { Rect, WindowState } from "@vibeos/shared";
import type { UiPatchPayload } from "@vibeos/shared/protocol";
import { carriesDataVersion } from "@/lib/patch";

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
  /** Recently closed unsaved experiences, newest first (server-maintained). */
  recent: WindowState[];
  /** Geometry during a drag: only the dragged window re-renders, not every window list. */
  dragRects: Record<string, Rect>;
  setDragRect: (id: string, rect?: Rect) => void;
  setRecent: (windows: WindowState[]) => void;
  setAll: (windows: WindowState[], snapshots: Record<string, string>, busyIds?: string[]) => void;
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
  recent: [],
  dragRects: {},
  setRecent: (recent) => set({ recent }),
  setDragRect: (id, rect) =>
    set((s) => {
      const dragRects = { ...s.dragRects };
      if (rect) dragRects[id] = rect;
      else delete dragRects[id];
      return { dragRects };
    }),
  setAll: (windows, snapshots, busyIds = []) =>
    set((s) => {
      const map: Record<string, WindowState> = {};
      for (const w of windows) map[w.id] = w;
      // The server's view replaces ours: a restart dropped every other generation.
      const busy: Record<string, boolean> = {};
      const progress: WindowStoreState["progress"] = {};
      for (const id of busyIds) {
        busy[id] = true;
        progress[id] = s.progress[id] ?? { since: Date.now() };
      }
      const failed = Object.fromEntries(Object.entries(s.failed).filter(([id]) => map[id]));
      // An unchanged snapshot keeps its last patch, so a reconnect does not
      // rebuild live surfaces (or restart running interactive scripts).
      const patches = Object.fromEntries(
        Object.entries(s.patches).filter(([id]) => map[id] && snapshots[id] === s.snapshots[id]),
      );
      return { windows: map, snapshots, patches, busy, progress, failed };
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
      // Only windows whose focus changes get new objects; the rest stay memoized.
      for (const [k, w] of Object.entries(windows))
        if (w.focused && k !== id) windows[k] = { ...w, focused: false };
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
      ...(s.windows[patch.windowId] && carriesDataVersion(patch)
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
      // The server merges regions; an acknowledgement without html keeps the snapshot.
      snapshots: {
        ...s.snapshots,
        [patch.windowId]: patch.html ?? s.snapshots[patch.windowId] ?? "",
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
