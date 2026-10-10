import { useSkinStore } from "@/stores/skinStore";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Reorder } from "motion/react";
// Phosphor, not lucide: these share the Dock row with the Phosphor app icons.
import { Bell, SquaresFour } from "@phosphor-icons/react";
import { AppIcon } from "@/components/AppIcon";
import { useScrollFade } from "@/hooks/useScrollFade";
import { useWindowStore } from "@/stores/windowStore";
import { useAppStore } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { wsClient } from "@/lib/ws";
import { StartMenu } from "@/components/startmenu/StartMenu";
import { Clock } from "./Clock";
import { appLabel, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { openContextMenu } from "@/components/contextmenu/ContextMenu";
import { taskbarMenu, taskbarItemMenu } from "@/components/contextmenu/menus";

export function Taskbar({
  onToggleNotifications,
  onAppSearch,
}: {
  onToggleNotifications: () => void;
  onAppSearch: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const t = useT();
  const windowMap = useWindowStore((s) => s.windows);
  const busy = useWindowStore((s) => s.busy);
  const windows = useMemo(
    () =>
      Object.values(windowMap)
        .filter((w) => w.isOpen && w.kind !== "widget")
        .sort((a, b) => a.order - b.order),
    [windowMap],
  );
  const apps = useAppStore((s) => s.apps);
  const selectedSkin = useSettingsStore((s) => s.settings?.skin ?? "devdock");
  const skin = useSkinStore(
    (s) => s.skins.find((skin) => skin.id === selectedSkin)?.foundation ?? selectedSkin,
  );
  const unread = useNotificationStore((s) => s.notifications.filter((n) => !n.read).length);
  // Red is reserved for unread errors; ordinary unread items get a neutral badge.
  const unreadError = useNotificationStore((s) =>
    s.notifications.some((n) => !n.read && n.kind === "error"),
  );
  // XP keeps its iconic "start"; the macOS-style Default/Aqua docks say "Apps".
  const startLabel = skin === "xp" ? t("taskbar.start") : t("taskbar.apps");
  const bar = useRef<HTMLDivElement>(null);
  const fade = useScrollFade("x");
  // The hovered Dock item's name, drawn from the bar so the strip cannot clip it.
  const [tip, setTip] = useState<{ id: string; text: string; x: number } | null>(null);
  const showTip = (id: string, item: HTMLElement) => {
    const label = item.querySelector<HTMLElement>(".vibe-taskitem-label");
    // Dock skins make the label a tooltip (absolute); taskbar skins show it inline.
    if (!label || !bar.current || getComputedStyle(label).position !== "absolute") return;
    const r = item.getBoundingClientRect();
    const b = bar.current.getBoundingClientRect();
    setTip({
      id,
      text: label.textContent ?? "",
      x: r.left + r.width / 2 - b.left - bar.current.clientLeft,
    });
  };
  // The first desktop staggers the Dock in by this order (see .vibe-desktop[data-reveal]).
  const order = (i: number) => ({ "--i": i }) as CSSProperties;
  // Press feedback only; hover colors switch instantly. Only `scale` transitions:
  // motion moves Dock items with `transform` while reordering.
  const press = "transition-[scale] duration-100 ease-out active:scale-[0.97]";

  return (
    <>
      <StartMenu open={menuOpen} onClose={() => setMenuOpen(false)} onAppSearch={onAppSearch} />
      <div
        ref={bar}
        className="vibe-taskbar absolute inset-x-0 bottom-0 z-[9998] flex h-[var(--taskbar-h)] items-center gap-1 border-t bg-card/90 px-2 backdrop-blur inset-shadow-sheen"
        onContextMenu={(e) => openContextMenu(e, taskbarMenu({ t }))}
      >
        <button
          onClick={() => setMenuOpen((v) => !v)}
          data-open={menuOpen ? "true" : undefined}
          data-popover-trigger="start"
          style={order(0)}
          className={cn(
            // The icon's side sits a little tighter: its own air already pads it.
            "vibe-startbtn flex h-8 items-center gap-2 rounded-lg pl-2.5 pr-3 text-sm font-medium",
            press,
            menuOpen ? "bg-accent text-accent-foreground" : "hover:bg-accent",
          )}
        >
          <SquaresFour weight="duotone" className="size-4" />
          {startLabel}
        </button>

        {/* Divider between "Apps" and the running-apps strip. With nothing
            running the tray already has its own divider, so this one would just
            float beside an empty strip — drop it until an app opens. */}
        {windows.length > 0 && <div className="mx-1 h-5 w-px bg-border" />}

        <Reorder.Group
          ref={fade}
          axis="x"
          as="div"
          values={windows.map((w) => w.id)}
          onReorder={(ids: string[]) => {
            useWindowStore.getState().reorder(ids); // optimistic
            wsClient.send("c2s.window.reorder", { ids });
          }}
          // The scrollbar stays hidden; the fade on a cut-off edge says there is more.
          className="vibe-fade-x flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar"
        >
          {windows.map((w, i) => {
            const app = apps[w.appId];
            return (
              <Reorder.Item
                key={w.id}
                value={w.id}
                as="button"
                onClick={() => wsClient.send("c2s.window.focus", { windowId: w.id })}
                onContextMenu={(e) => openContextMenu(e, taskbarItemMenu({ t, win: w }))}
                onPointerEnter={(e) => showTip(w.id, e.currentTarget)}
                onPointerLeave={() => setTip(null)}
                onDragStart={() => setTip(null)}
                data-win-id={w.id}
                data-active={w.focused && w.state !== "minimized" ? "true" : undefined}
                aria-busy={busy[w.id] || undefined}
                style={order(i + 1)}
                className={cn(
                  "vibe-taskitem flex h-8 max-w-44 items-center gap-2 rounded-lg px-2.5 text-xs",
                  press,
                  w.focused && w.state !== "minimized"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                <AppIcon
                  name={app?.icon}
                  presetId={app?.presetId}
                  label={appLabel(t, app, w.title)}
                  className="size-4"
                />
                <span className="vibe-taskitem-label truncate">{appLabel(t, app, w.title)}</span>
                {busy[w.id] && (
                  <span className="vibe-taskitem-busy size-1.5 shrink-0 rounded-full bg-brand motion-safe:animate-pulse" />
                )}
              </Reorder.Item>
            );
          })}
        </Reorder.Group>

        <div
          className="vibe-tray-area flex h-full items-center gap-1"
          style={order(windows.length + 1)}
        >
          <button
            onClick={onToggleNotifications}
            data-popover-trigger="notifications"
            className={cn(
              "vibe-tray relative flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground",
              press,
            )}
            title={t("taskbar.notifications")}
          >
            <Bell weight="duotone" className="size-4" />
            {unread > 0 && (
              <span
                className={cn(
                  "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-2xs leading-none font-semibold",
                  unreadError ? "bg-destructive-fill text-white" : "bg-foreground text-background",
                )}
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          <Clock />
        </div>
        {tip && windows.some((w) => w.id === tip.id) && (
          <span aria-hidden="true" className="vibe-docktip" style={{ left: tip.x }}>
            {tip.text}
          </span>
        )}
      </div>
    </>
  );
}
