import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search } from "lucide-react";
import type { AppDescriptor } from "@vibeos/shared";
import { AppIcon } from "@/components/AppIcon";
import { useAppStore } from "@/stores/appStore";
import { useWindowStore } from "@/stores/windowStore";
import { wsClient } from "@/lib/ws";
import { appLabel, useT } from "@/lib/i18n";
import { usePopoverMotion } from "@/lib/motion";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { useScrollFade } from "@/hooks/useScrollFade";

const TRIGGER = '[data-popover-trigger="start"]';

interface Props {
  open: boolean;
  onClose: () => void;
  onAppSearch: () => void;
}

export function StartMenu({ open, onClose, onAppSearch }: Props) {
  const appMap = useAppStore((s) => s.apps);
  const apps = useMemo(
    () => Object.values(appMap).filter((a) => a.isInstalled && a.id !== "__transient__"),
    [appMap],
  );
  const system = useMemo(() => apps.filter((a) => a.kind === "preset"), [apps]);
  const generated = useMemo(() => apps.filter((a) => a.kind === "virtual"), [apps]);
  const recent = useWindowStore((s) => s.recent);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const menu = usePopoverMotion();
  const anchor = useAnchoredPopover(open, TRIGGER, "left", 320);
  const fade = useScrollFade("y");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      // Ignore the trigger so clicking it toggles closed (not close-then-reopen).
      if ((e.target as HTMLElement)?.closest?.(TRIGGER)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    // Keyboard users land inside the menu.
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const launch = (appId: string) => {
    wsClient.send("c2s.window.open", { appId });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          {...menu}
          style={anchor}
          // Capped to the room above the Dock: the search stays put and the apps
          // scroll. 18px corners = the 10px tiles + 8px padding + 1px border.
          className="vibe-startmenu z-[9999] flex max-h-(--anchor-max-h) w-80 origin-bottom-left flex-col rounded-2xl border bg-popover/95 p-2 shadow-popover inset-shadow-sheen backdrop-blur"
        >
          <button
            onClick={() => {
              onClose();
              onAppSearch();
            }}
            className="vibe-startsearch mb-2 flex w-full shrink-0 items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left hover:bg-accent"
          >
            <Search className="size-4 text-muted-foreground" />
            <span className="flex-1 text-sm">{t("startmenu.appSearch")}</span>
            <span className="text-2xs text-muted-foreground">{t("startmenu.appSearchHint")}</span>
          </button>

          <div ref={fade} className="vibe-fade-y min-h-0 flex-1 overflow-y-auto">
            <AppSection title={t("startmenu.system")} apps={system} onLaunch={launch} />
            {generated.length > 0 && (
              <AppSection title={t("startmenu.generated")} apps={generated} onLaunch={launch} />
            )}
            {recent.length > 0 && (
              // Unsaved experiences come back with their last view; nothing regenerates.
              <AppSection
                title={t("startmenu.recent")}
                apps={recent.flatMap((w) => {
                  const app = appMap[w.appId];
                  return app ? [{ ...app, id: w.id, name: w.title }] : [];
                })}
                onLaunch={(windowId) => {
                  wsClient.send("c2s.window.reopen", { windowId });
                  onClose();
                }}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AppSection({
  title,
  apps,
  onLaunch,
}: {
  title: string;
  apps: AppDescriptor[];
  onLaunch: (appId: string) => void;
}) {
  const t = useT();
  return (
    <div className="vibe-startsection mb-1">
      <div className="mb-1 px-1 text-2xs font-medium text-muted-foreground">{title}</div>
      {/* Tiles touch: the breathing room is their padding, so the hover never drops
          out between two of them. */}
      <div className="grid grid-cols-3">
        {apps.map((app) => (
          <button
            key={app.id}
            onClick={() => onLaunch(app.id)}
            className="vibe-startapp flex flex-col items-center gap-1.5 rounded-lg p-3 text-center transition-[scale] duration-100 ease-out hover:bg-accent active:scale-[0.97]"
          >
            <AppIcon
              name={app.icon}
              presetId={app.presetId}
              label={appLabel(t, app)}
              className="size-7"
            />
            <span className="line-clamp-1 text-xs text-foreground/90">{appLabel(t, app)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
