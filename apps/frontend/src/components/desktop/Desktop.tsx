import { useEffect, useMemo, useState } from "react";
import { useVfsStore } from "@/stores/vfsStore";
import { useAppStore } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/lib/i18n";
import { WindowManager } from "@/components/window/WindowManager";
import { Taskbar } from "@/components/taskbar/Taskbar";
import { DesktopIcon } from "./DesktopIcon";
import { NotificationToasts } from "@/components/notifications/NotificationToasts";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { Spotlight } from "@/components/spotlight/Spotlight";
import { ContextMenuRoot, openContextMenu } from "@/components/contextmenu/ContextMenu";
import { desktopMenu } from "@/components/contextmenu/menus";
import { wsClient, API_BASE } from "@/lib/ws";
import { gridPosition } from "@/lib/desktopGrid";

export function Desktop() {
  const nodeMap = useVfsStore((s) => s.nodes);
  const nodes = useMemo(
    () => Object.values(nodeMap).filter((n) => n.location === "desktop"),
    [nodeMap],
  );
  const [notifOpen, setNotifOpen] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const t = useT();
  const appMap = useAppStore((s) => s.apps);
  const skin = useSettingsStore((s) => s.settings?.skin ?? "devdock");
  const theme = useSettingsStore((s) => s.settings?.theme ?? "dark");
  const wallpaper = useSettingsStore((s) => s.settings?.prefs.wallpaper);
  const wallpaperUrl = wallpaper ? `${API_BASE}${wallpaper}` : null;

  // ⌘K / ⌘Space (and Ctrl variants) toggle the App Search, like Spotlight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.code === "Space" || e.key.toLowerCase() === "k")) {
        e.preventDefault();
        setSpotlightOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const autoArrange = () => {
    const desktopNodes = Object.values(useVfsStore.getState().nodes).filter(
      (n) => n.location === "desktop",
    );
    desktopNodes.forEach((n, i) => {
      const { x, y } = gridPosition(i, window.innerHeight);
      useVfsStore.getState().upsert({ ...n, x, y });
      wsClient.send("c2s.vfs.move", { nodeId: n.id, location: "desktop", x, y });
    });
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-desktop"
      onContextMenu={(e) =>
        openContextMenu(
          e,
          desktopMenu({
            t,
            apps: Object.values(appMap).filter((a) => a.id !== "__transient__"),
            skin,
            theme,
            onAppSearch: () => setSpotlightOpen(true),
            onAutoArrange: autoArrange,
          }),
        )
      }
    >
      {/* Base wallpaper gradient — also the fallback shown while a custom/AI
          wallpaper is still loading or generating. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 80% 0%, color-mix(in oklab, var(--brand) 14%, transparent), transparent 60%)",
        }}
      />

      {/* User wallpaper (uploaded or AI-generated). Overlays the gradient and
          covers it once the image loads — no broken state while it generates. */}
      {wallpaperUrl && (
        <>
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${wallpaperUrl}")` }}
          />
          {/* Subtle scrim keeps desktop icon labels legible over any image. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/25" />
        </>
      )}

      {/* desktop icons */}
      <div className="absolute inset-0 bottom-11">
        {nodes.map((n) => (
          <DesktopIcon key={n.id} node={n} />
        ))}
      </div>

      <WindowManager />

      <NotificationToasts />
      <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />

      <Spotlight open={spotlightOpen} onClose={() => setSpotlightOpen(false)} />

      <Taskbar
        onToggleNotifications={() => setNotifOpen((v) => !v)}
        onAppSearch={() => setSpotlightOpen(true)}
      />

      <ContextMenuRoot />
    </div>
  );
}
