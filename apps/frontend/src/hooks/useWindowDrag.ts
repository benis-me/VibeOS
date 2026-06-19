import { useCallback, useRef } from "react";
import type { Rect } from "@vibeos/shared";
import { wsClient } from "@/lib/ws";
import { useWindowStore } from "@/stores/windowStore";
import { useAppStore } from "@/stores/appStore";

/** Resize direction: any combination of edges. "" = move. */
export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_W = 320;
const MIN_H = 200;

/** Pointer-based move/resize that updates the store live and persists on release. */
export function useWindowDrag(windowId: string) {
  const frame = useRef<number | null>(null);
  const latest = useRef<Rect | null>(null);

  const begin = useCallback(
    (dir: ResizeDir | "move", e: React.PointerEvent) => {
      e.preventDefault();
      // NOTE: do not stopPropagation — let pointerdown bubble to the window
      // root so clicking the titlebar/edges also focuses the window.
      const w = useWindowStore.getState().windows[windowId];
      if (!w) return;
      // Per-app minimum size (e.g. Settings = 850 wide), falling back to global.
      const ms = useAppStore.getState().apps[w.appId]?.manifest?.minSize;
      const minW = ms?.w ?? MIN_W;
      const minH = ms?.h ?? MIN_H;
      const start = { px: e.clientX, py: e.clientY, ...w.rect };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - start.px;
        const dy = ev.clientY - start.py;
        let rect: Rect;

        if (dir === "move") {
          rect = {
            x: Math.max(0, start.x + dx),
            y: Math.max(0, start.y + dy),
            w: start.w,
            h: start.h,
          };
        } else {
          let { x, y, w: width, h: height } = start;
          if (dir.includes("e")) width = Math.max(minW, start.w + dx);
          if (dir.includes("s")) height = Math.max(minH, start.h + dy);
          if (dir.includes("w")) {
            const nw = Math.max(minW, start.w - dx);
            x = start.x + (start.w - nw);
            width = nw;
          }
          if (dir.includes("n")) {
            const nh = Math.max(minH, start.h - dy);
            y = start.y + (start.h - nh);
            height = nh;
          }
          rect = { x: Math.max(0, x), y: Math.max(0, y), w: width, h: height };
        }

        latest.current = rect;
        if (frame.current == null) {
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            const cur = useWindowStore.getState().windows[windowId];
            if (cur && latest.current) {
              useWindowStore.getState().upsert({ ...cur, rect: latest.current });
            }
          });
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (frame.current != null) cancelAnimationFrame(frame.current);
        frame.current = null;
        const rect = latest.current;
        latest.current = null;
        if (rect) {
          wsClient.send("c2s.window.move", { windowId, ...rect });
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [windowId],
  );

  return {
    onMoveHandle: (e: React.PointerEvent) => begin("move", e),
    onResize: (dir: ResizeDir) => (e: React.PointerEvent) => begin(dir, e),
  };
}
