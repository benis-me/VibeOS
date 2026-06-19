import { motion } from "motion/react";
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
import { useWindowMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { openContextMenu } from "@/components/contextmenu/ContextMenu";
import { windowMenu, appContentMenu } from "@/components/contextmenu/menus";

export function Window({ win }: { win: WindowState }) {
  const html = useWindowStore((s) => s.snapshots[win.id] ?? "");
  const app = useAppStore((s) => s.apps[win.appId]);
  const { onMoveHandle, onResize } = useWindowDrag(win.id);
  const t = useT();
  const winMotion = useWindowMotion();
  // Native (React) apps render their own component; everything else is AI HTML
  // and can be frozen into a reusable app.
  const native = app?.presetId ? NATIVE_APPS[app.presetId] : undefined;

  if (win.state === "minimized") return null;

  const maximized = win.state === "maximized";
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
      role="dialog"
      aria-label={win.title}
      onPointerDown={focus}
      {...winMotion}
      data-focused={win.focused ? "true" : undefined}
      data-maximized={maximized ? "true" : undefined}
      className={cn(
        "vibe-window absolute flex flex-col overflow-hidden rounded-xl border sheen transition-shadow",
        win.focused
          ? // focused: frosted glass + a thin soft shadow
            "ring-1 ring-ring/30 win-focused win-glass"
          : // unfocused: plain solid surface, no blur
            "bg-card",
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: maximized ? "calc(100vh - var(--taskbar-h))" : rect.h,
        zIndex: win.z,
        borderRadius: maximized ? 0 : undefined,
      }}
    >
      {/* titlebar */}
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

      {/* content — always solid so the AI UI stays readable; the glass shows
          through the titlebar / window edges of the focused window. */}
      <div
        className="vibe-window-body relative min-h-0 flex-1 bg-background"
        onContextMenu={(e) => openContextMenu(e, appContentMenu({ t, win, native: !!native }))}
      >
        {native ? native() : <AiHtmlSurface windowId={win.id} html={html} />}
      </div>

      {/* 8-direction resize handles (edges + corners) */}
      {!maximized && (
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
}

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
