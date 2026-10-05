import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Minus, Square, X, Copy, Save, Loader2, Sparkles } from "lucide-react";
import type { WindowState } from "@vibeos/shared";
import { wsClient } from "@/lib/ws";
import { useAppStore } from "@/stores/appStore";
import { useWindowStore } from "@/stores/windowStore";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { AiHtmlSurface } from "./AiHtmlSurface";
import { AppEditBar } from "./AppEditBar";
import { InteractiveSurface } from "./InteractiveSurface";
import { NATIVE_APPS } from "./nativeApps";
import { CHROMES } from "./chromes";
import { AppIcon } from "@/components/AppIcon";
import { appLabel, useT } from "@/lib/i18n";
import { useWindowMotion, EASE_OUT } from "@/lib/motion";
import { clock, cn } from "@/lib/utils";
import { openContextMenu } from "@/components/contextmenu/ContextMenu";
import { windowMenu, appContentMenu } from "@/components/contextmenu/menus";
import { closeWindow } from "@/lib/windowClose";

// Memoized so dragging/focusing one window doesn't re-render every other
// window's surface (which would re-inject HTML and stutter the drag).
export const Window = memo(function Window({ win, layer }: { win: WindowState; layer: number }) {
  const app = useAppStore((s) => s.apps[win.appId]);
  const { onMoveHandle, onResize } = useWindowDrag(win.id);
  const t = useT();
  const title = appLabel(t, app, win.title);
  const winMotion = useWindowMotion();
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Where to fly to when minimizing: the delta from the window centre to this
  // window's Dock/taskbar item, so it shrinks INTO its icon (genie).
  const [minTarget, setMinTarget] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const closeEdit = useCallback(() => setEditing(false), []);
  // Native (React) apps render their own component; everything else is AI HTML
  // and can be frozen into a reusable app.
  const native = app?.presetId ? NATIVE_APPS[app.presetId] : undefined;
  // Some AI apps have a NATIVE chrome shell (e.g. browser address bar) wrapping
  // the generated content; the AI fills only the content region.
  const chromeKey = typeof app?.manifest.chrome === "string" ? app.manifest.chrome : undefined;
  const Chrome = !native && chromeKey ? CHROMES[chromeKey] : undefined;

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
  // Fit the current screen without losing the preferred geometry on a larger screen.
  // CSS keeps this responsive to both viewport and skin/taskbar changes.
  const rect = useWindowStore((s) => s.dragRects[win.id]) ?? win.rect;
  const width = maximized ? "100vw" : `min(${rect.w}px, 100vw)`;
  const availableHeight = "calc(100vh - var(--taskbar-h))";
  const height = maximized ? availableHeight : `min(${rect.h}px, ${availableHeight})`;

  const focus = () => {
    if (!win.focused) wsClient.send("c2s.window.focus", { windowId: win.id });
  };

  return (
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      onPointerDown={widget ? undefined : focus}
      initial={winMotion.initial}
      exit={winMotion.exit}
      // Minimize/restore: shrink INTO the window's Dock icon and fade (genie).
      animate={
        minimized
          ? reduced
            ? { opacity: 0 }
            : {
                opacity: 0,
                scale: 0.15,
                x: minTarget?.x ?? 0,
                y: minTarget?.y ?? 240,
              }
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
          ? "rounded-2xl border-white/20 bg-card/25 shadow-xl backdrop-blur-2xl"
          : win.focused
            ? "rounded-xl ring-1 ring-ring/30 win-focused win-glass"
            : "rounded-xl bg-card win-unfocused",
      )}
      style={{
        left: maximized ? 0 : `clamp(0px, ${rect.x}px, calc(100vw - ${width}))`,
        top: maximized ? 0 : `clamp(0px, ${rect.y}px, calc(${availableHeight} - ${height}))`,
        width,
        height,
        // Widgets sit on the desktop, behind normal windows.
        zIndex: widget ? 0 : layer,
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
            label={title}
            className={cn("size-4", !win.focused && "opacity-50")}
          />
          <span
            className={cn(
              "vibe-title flex-1 truncate text-xs font-medium",
              win.focused ? "text-foreground/90" : "text-muted-foreground",
            )}
          >
            {title}
          </span>
          {!native && (
            // Kept apart from the window controls: these are not more traffic lights.
            // The generation pill leads them, out of the centered title's way.
            <div className="vibe-titlebar-actions flex shrink-0 items-center gap-0.5">
              <GenerationStatus windowId={win.id} />
              <button
                type="button"
                title={t("win.editApp")}
                aria-label={t("win.editApp")}
                aria-expanded={editing}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setEditing((v) => !v)}
                className="vibe-titlebar-action flex size-6 shrink-0 items-center justify-center rounded-md opacity-60 transition hover:bg-current/10 hover:opacity-100"
              >
                <Sparkles className="size-3.5" />
              </button>
              <button
                type="button"
                title={t("win.saveAsApp")}
                aria-label={t("win.saveAsApp")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => wsClient.send("c2s.app.save", { windowId: win.id })}
                className="vibe-titlebar-action flex size-6 shrink-0 items-center justify-center rounded-md opacity-60 transition hover:bg-current/10 hover:opacity-100"
              >
                <Save className="size-3.5" />
              </button>
            </div>
          )}
          <div className="vibe-winbtns flex items-center gap-1">
            <TitleButton
              kind="min"
              title={t("win.minimize")}
              onClick={() => wsClient.send("c2s.window.minimize", { windowId: win.id })}
            >
              <Minus className="size-3.5" />
            </TitleButton>
            <TitleButton
              kind="max"
              title={t("win.maximize")}
              onClick={() => wsClient.send("c2s.window.maximize", { windowId: win.id })}
            >
              {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
            </TitleButton>
            <TitleButton
              kind="close"
              title={t("win.close")}
              danger
              onClick={() => closeWindow(win)}
            >
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
            onClick={() => closeWindow(win)}
            title={t("win.close")}
            className="absolute right-1.5 top-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-background/70 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive-fill hover:text-white group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </>
      )}

      {/* content — always solid so the AI UI stays readable; the glass shows
          through the titlebar / window edges of the focused window. */}
      <div
        className={cn(
          "vibe-window-body relative min-h-0 flex-1",
          // Widgets are frosted glass: keep the body transparent so the blurred
          // desktop shows through (the AI content is told to stay transparent too).
          widget ? "bg-transparent" : "bg-background",
        )}
        onContextMenu={(e) => openContextMenu(e, appContentMenu({ t, win, native: !!native }))}
      >
        {!native && <GenerationFailure windowId={win.id} />}
        {!native && editing && <AppEditBar win={win} onClose={closeEdit} />}
        {native ? (
          native(win.id)
        ) : Chrome ? (
          <Chrome windowId={win.id}>
            {win.runtime === "interactive" ? (
              <InteractiveSurface key={win.appVersionId} windowId={win.id} />
            ) : (
              <AiHtmlSurface windowId={win.id} />
            )}
          </Chrome>
        ) : win.runtime === "interactive" ? (
          <InteractiveSurface key={win.appVersionId} windowId={win.id} />
        ) : (
          <AiHtmlSurface windowId={win.id} />
        )}
      </div>

      {/* 8-direction resize handles (edges + corners) */}
      {!maximized && !widget && (
        <>
          {/* edges */}
          <div
            onPointerDown={onResize("n")}
            className="absolute inset-x-2 top-0 h-1.5 cursor-ns-resize"
            aria-hidden
          />
          <div
            onPointerDown={onResize("s")}
            className="absolute inset-x-2 bottom-0 h-1.5 cursor-ns-resize"
            aria-hidden
          />
          <div
            onPointerDown={onResize("w")}
            className="absolute inset-y-2 left-0 w-1.5 cursor-ew-resize"
            aria-hidden
          />
          <div
            onPointerDown={onResize("e")}
            className="absolute inset-y-2 right-0 w-1.5 cursor-ew-resize"
            aria-hidden
          />
          {/* corners */}
          <div
            onPointerDown={onResize("nw")}
            className="absolute left-0 top-0 size-3 cursor-nwse-resize"
            aria-hidden
          />
          <div
            onPointerDown={onResize("ne")}
            className="absolute right-0 top-0 size-3 cursor-nesw-resize"
            aria-hidden
          />
          <div
            onPointerDown={onResize("sw")}
            className="absolute bottom-0 left-0 size-3 cursor-nesw-resize"
            aria-hidden
          />
          <div
            onPointerDown={onResize("se")}
            className="absolute bottom-0 right-0 size-3 cursor-nwse-resize"
            aria-hidden
          />
        </>
      )}
    </motion.div>
  );
});

/**
 * While the AI generates this window: a fixed-width pill with the elapsed time
 * and Stop. The model's latest summary is its tooltip, so the width never moves.
 */
function GenerationStatus({ windowId }: { windowId: string }) {
  const t = useT();
  const progress = useWindowStore((s) => s.progress[windowId]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!progress) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [progress]);
  if (!progress) return null;
  const stop = () => {
    wsClient.send("c2s.window.cancel", { windowId });
    const store = useWindowStore.getState();
    // Nothing rendered yet: say why the window stays empty and offer a retry.
    if (!store.snapshots[windowId]?.trim()) store.setFailed(windowId, "win.stopped");
  };
  return (
    <span
      className="vibe-genstatus mr-1 flex h-5 shrink-0 items-center gap-1 rounded-full bg-current/10 pl-1.5 pr-0.5 text-2xs"
      title={progress.status || t("win.generating")}
    >
      <Loader2 className="size-3 shrink-0 opacity-70 motion-safe:animate-spin" />
      <span className="opacity-80">{t("win.generating")}</span>
      <span className="tabular-nums opacity-60">{clock(now - progress.since)}</span>
      <button
        type="button"
        title={t("win.stop")}
        aria-label={t("win.stop")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={stop}
        className="vibe-genstop flex size-4 shrink-0 items-center justify-center rounded-full opacity-70 transition hover:bg-current/15 hover:opacity-100"
      >
        <Square className="size-2 fill-current" />
      </button>
    </span>
  );
}

/** Generation failed or was stopped: say so inside the window, with a retry. */
function GenerationFailure({ windowId }: { windowId: string }) {
  const t = useT();
  const reason = useWindowStore((s) => s.failed[windowId]);
  if (!reason) return null;
  const regenerate = () => {
    if (wsClient.send("c2s.op", { windowId, op: { kind: "custom", action: "reload" } }))
      useWindowStore.getState().setBusy(windowId, true);
  };
  return (
    <div
      role="alert"
      className="vibe-genfailed absolute inset-x-0 top-0 z-30 flex items-center gap-2 border-b bg-background px-3 py-2 text-xs"
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          reason === "win.stopped" ? "text-muted-foreground" : "text-destructive",
        )}
      >
        {t(reason)}
      </span>
      <button type="button" onClick={regenerate} className="vibe-btn rounded border px-2 py-1">
        {t("win.regenerate")}
      </button>
      <button
        type="button"
        onClick={() => wsClient.send("c2s.window.open", { appId: "activity-monitor" })}
        className="vibe-btn rounded border px-2 py-1"
      >
        {t("win.details")}
      </button>
      <button
        type="button"
        aria-label={t("communication.dismiss")}
        onClick={() => useWindowStore.getState().setFailed(windowId)}
        className="vibe-btn rounded border px-2 py-1"
      >
        <X className="size-3.5" />
      </button>
    </div>
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
  kind?: "min" | "max" | "close";
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
        danger
          ? "hover:bg-destructive-fill hover:text-white"
          : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
