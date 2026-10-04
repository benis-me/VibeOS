import { create } from "zustand";
import { NATIVE_PRESET_APPS, type WindowState } from "@vibeos/shared";
import { useAppStore } from "@/stores/appStore";
import { wsClient } from "./ws";

/** A window with unsaved work confirms in place, then runs `close` itself. */
type Guard = (close: () => void) => boolean;
const guards = new Map<string, Guard>();
export function guardClose(windowId: string, guard: Guard): () => void {
  guards.set(windowId, guard);
  return () => {
    if (guards.get(windowId) === guard) guards.delete(windowId);
  };
}

/** The last generated window the user closed, offered for undo. */
export const useClosedStore = create<{ closed: { windowId: string; title: string } | null }>(
  () => ({ closed: null }),
);

/** A user's close: unsaved work is confirmed first, generated windows can be undone. */
export function closeWindow(win: WindowState): void {
  const presetId = useAppStore.getState().apps[win.appId]?.presetId;
  const close = () => {
    wsClient.send("c2s.window.close", { windowId: win.id });
    if (!(presetId && NATIVE_PRESET_APPS.includes(presetId)))
      useClosedStore.setState({ closed: { windowId: win.id, title: win.title } });
  };
  const guard = guards.get(win.id);
  if (!guard || guard(close)) close();
}
