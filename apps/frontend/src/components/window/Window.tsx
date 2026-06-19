import { memo, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Minus, Square, X, Copy, Save } from "lucide-react";
import type { WindowState } from "@vibeos/shared";
import { wsClient } from "@/lib/ws";
import { useWindowStore } from "@/stores/windowStore";
import { useAppStore } from "@/stores/appStore";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { AiHtmlSurface } from "./AiHtmlSurface";
import { NATIVE_APPS } from "./nativeApps";
import { AppIcon } from "@/components/AppIcon";
import { useT } from "@/lib/i18n";
import { useWindowMotion, EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { openContextMenu } from "@/components/contextmenu/ContextMenu";
import { windowMenu, appContentMenu } from "@/components/contextmenu/menus";

// Memoized so dragging/focusing one window doesn't re-render every other
// window's surface (which would re-inject HTML and stutter the drag).
export const Window = memo(function Window({ win }: { win: WindowState }) {
  const html = useWindowStore((s) => s.snapshots[win.id] ?? "");
  const app = useAppStore((s) => s.apps[win.appId]);
  const { onMoveHandle, onResize } = useWindowDrag(win.id);
  const t = useT();
  const winMotion = useWindowMotion();
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Where to fly to when minimizing: the delta from the window centre to this
  // window's Dock/taskbar item, so it shrinks INTO its icon (genie).
  const [minTarget, setMinTarget] = useState<{ x: number; y: number } | null>(null);
  // Native (React) apps render their own component; everything else is AI HTML
  // and can be frozen into a reusable app.
  const native = app?.presetId ? NATIVE_APPS[app.presetId] : undefined;

  // Keep minimized windows MOUNTED but hidden — unmounting (return null) would
  // rebuild the AI surface on restore and lose scroll + DOM state.
  const minimized = win.state === "minimized";
  const maximized = win.state === "maximized";
  // Widgets are chrome-less AI panels pinned to the desktop (behind windows).
  const widget = win.kind === "widget";

  // When minimizing, measure the delta from the window's centre to its Dock
  // item so the genie animation flies INTO the icon (and back on restore).
  useLayoutEffect(() => {
    if (!minimized || reduced) return;
    const el = rootRef.current;
    const dock = document.querySelector(`[data-win-id="${win.id}"]`);
    if (!el || !dock) return;
    const wr = el.getBoundingClientRect();
    const dr = dock.getBoundingClientRect();
    setMinTarget({
      x: dr.left + dr.width / 2 - (wr.left + wr.width / 2),
      y: dr.top + dr.height / 2 - (wr.top + wr.height / 2),
    });
  }, [minimized, reduced, win.id]);
  // Maximized height is driven by the CSS taskbar-height var so it adapts when
  // a skin changes the taskbar height (e.g. XP's shorter bar).
  const rect = maximized
    ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
    : win.rect;

  const focus = () => {
    if (!win.focused) wsClient.send("c2s.window.focus", { windowId: win.id });
  };

  return (
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-label={win.title}
      onPointerDown={widget ? undefined : focus}
      initial={winMotion.initial}
      exit={winMotion.exit}
      // Minimize/restore: shrink INTO the window's Dock icon and fade (genie).
      animate={
        minimized
          ? reduced
            ? { opacity: 0 }
            : { opacity: 0, scale: 0.15, x: minTarget?.x ?? 0, y: minTarget?.y ?? 240 }
          : reduced
            ? { opacity: 1 }
            : { opacity: 1, scale: 1, x: 0, y: 0 }
      }
      transition={{ duration: reduced ? 0.12 : 0.3, ease: EASE_OUT }}
      data-focused={win.focused ? "true" : undefined}
      data-maximized={maximized ? "true" : undefined}
      aria-hidden={minimized || undefined}
      className={cn(
        "vibe-window group absolute flex flex-col overflow-hidden border sheen transition-shadow",
        widget
          ? "rounded-2xl bg-card shadow-xl"
          : win.focused
            ? "rounded-xl ring-1 ring-ring/30 win-focused win-glass"
            : "rounded-xl bg-card",
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: maximized ? "calc(100vh - var(--taskbar-h))" : rect.h,
        // Widgets sit on the desktop, behind normal windows.
        zIndex: widget ? 0 : win.z,
        borderRadius: maximized ? 0 : undefined,
        transformOrigin: "center",
        pointerEvents: minimized ? "none" : undefined,
      }}
    >
      {/* titlebar — omitted for chrome-less widgets */}
      {!widget && (
      <div
        onPointerDown={(e) => {
          focus(); // drag handler stops propagation, so focus explicitly here
          if (!maximized) onMoveHandle(e);
        }}
        onDoubleClick={() => wsClient.send("c2s.window.maximize", { windowId: win.id })}
        onContextMenu={(e) => openContextMenu(e, windowMenu({ t, win, native: !!native }))}
        className={cn(
          "vibe-titlebar flex h-9 shrink-0 items-center gap-2 border-b px-3 select-none",
          // focused titlebar is translucent so the frosted glass shows through;
          // unfocused is a flat greyed-out surface.
          win.focused ? "bg-window-titlebar/60" : "bg-muted/50",
        )}
      >
        <AppIcon
          name={app?.icon}
          presetId={app?.presetId}
          label={app?.name ?? win.title}
          className={cn("size-4", !win.focused && "opacity-50")}
        />
        <span
          className={cn(
            "vibe-title flex-1 truncate text-xs font-medium",
            win.focused ? "text-foreground/90" : "text-muted-foreground",
          )}
        >
          {win.title}
        </span>
        <div className="vibe-winbtns flex items-center gap-1">
          {!native && (
            <TitleButton kind="save" title={t("win.saveAsApp")} onClick={() => wsClient.send("c2s.app.save", { windowId: win.id })}>
              <Save className="size-3.5" />
            </TitleButton>
          )}
          <TitleButton kind="min" title={t("win.minimize")} onClick={() => wsClient.send("c2s.window.minimize", { windowId: win.id })}>
            <Minus className="size-3.5" />
          </TitleButton>
          <TitleButton kind="max" title={t("win.maximize")} onClick={() => wsClient.send("c2s.window.maximize", { windowId: win.id })}>
            {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
          </TitleButton>
          <TitleButton kind="close" title={t("win.close")} danger onClick={() => wsClient.send("c2s.window.close", { windowId: win.id })}>
            <X className="size-3.5" />
          </TitleButton>
        </div>
      </div>
      )}

      {/* Widget chrome: a hover drag-handle + close, overlaid on the content. */}
      {widget && (
        <>
          <div
            onPointerDown={(e) => onMoveHandle(e)}
            className="absolute inset-x-0 top-0 z-10 h-5 cursor-grab opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          >
            <div className="mx-auto mt-1 h-1 w-8 rounded-full bg-foreground/25" />
          </div>
          <button
            onClick={() => wsClient.send("c2s.window.close", { windowId: win.id })}
            title={t("win.close")}
            className="absolute right-1.5 top-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-background/70 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive hover:text-white group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </>
      )}

      {/* content — always solid so the AI UI stays readable; the glass shows
          through the titlebar / window edges of the focused window. */}
      <div
        className="vibe-window-body relative min-h-0 flex-1 bg-background"
        onContextMenu={(e) => openContextMenu(e, appContentMenu({ t, win, native: !!native }))}
      >
        {native ? native() : <AiHtmlSurface windowId={win.id} html={html} />}
      </div>

      {/* 8-direction resize handles (edges + corners) */}
      {!maximized && !widget && (
        <>
          {/* edges */}
          <div onPointerDown={onResize("n")} className="absolute inset-x-2 top-0 h-1.5 cursor-ns-resize" aria-hidden />
          <div onPointerDown={onResize("s")} className="absolute inset-x-2 bottom-0 h-1.5 cursor-ns-resize" aria-hidden />
          <div onPointerDown={onResize("w")} className="absolute inset-y-2 left-0 w-1.5 cursor-ew-resize" aria-hidden />
          <div onPointerDown={onResize("e")} className="absolute inset-y-2 right-0 w-1.5 cursor-ew-resize" aria-hidden />
          {/* corners */}
          <div onPointerDown={onResize("nw")} className="absolute left-0 top-0 size-3 cursor-nwse-resize" aria-hidden />
          <div onPointerDown={onResize("ne")} className="absolute right-0 top-0 size-3 cursor-nesw-resize" aria-hidden />
          <div onPointerDown={onResize("sw")} className="absolute bottom-0 left-0 size-3 cursor-nesw-resize" aria-hidden />
          <div onPointerDown={onResize("se")} className="absolute bottom-0 right-0 size-3 cursor-nwse-resize" aria-hidden />
        </>
      )}
    </motion.div>
  );
});

function TitleButton({
  children,
  onClick,
  title,
  kind,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  kind?: "save" | "min" | "max" | "close";
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        "vibe-winbtn flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors",
        kind && `vibe-winbtn-${kind}`,
        danger ? "hover:bg-destructive hover:text-white" : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
