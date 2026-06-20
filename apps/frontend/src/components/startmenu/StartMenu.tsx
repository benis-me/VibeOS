import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search } from "lucide-react";
import type { AppDescriptor } from "@vibeos/shared";
import { AppIcon } from "@/components/AppIcon";
import { useAppStore } from "@/stores/appStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { usePopoverMotion } from "@/lib/motion";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { cn } from "@/lib/utils";

const TRIGGER = '[data-popover-trigger="start"]';

interface Props {
  open: boolean;
  onClose: () => void;
  onAppSearch: () => void;
}

export function StartMenu({ open, onClose, onAppSearch }: Props) {
  const appMap = useAppStore((s) => s.apps);
  const apps = useMemo(
    () => Object.values(appMap).filter((a) => a.id !== "__transient__"),
    [appMap],
  );
  const system = useMemo(() => apps.filter((a) => a.kind === "preset"), [apps]);
  const generated = useMemo(() => apps.filter((a) => a.kind === "virtual"), [apps]);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const menu = usePopoverMotion();
  const anchor = useAnchoredPopover(open, TRIGGER, "left", 320);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      // Ignore the trigger so clicking it toggles closed (not close-then-reopen).
      if ((e.target as HTMLElement)?.closest?.(TRIGGER)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
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
          className={cn(
            "vibe-startmenu z-[9999] w-80 origin-bottom-left rounded-xl border bg-popover/95 p-3 shadow-2xl backdrop-blur sheen",
          )}
        >
          <button
            onClick={() => {
              onClose();
              onAppSearch();
            }}
            className="vibe-startsearch mb-3 flex w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent"
          >
            <Search className="size-4 text-muted-foreground" />
            <span className="flex-1 text-sm">{t("startmenu.appSearch")}</span>
            <span className="text-[10px] text-muted-foreground">
              {t("startmenu.appSearchHint")}
            </span>
          </button>

          <AppSection title={t("startmenu.system")} apps={system} onLaunch={launch} />
          {generated.length > 0 && (
            <AppSection title={t("startmenu.generated")} apps={generated} onLaunch={launch} />
          )}
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
  return (
    <div className="vibe-startsection mb-1">
      <div className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">{title}</div>
      <div className="grid grid-cols-3 gap-1">
        {apps.map((app) => (
          <button
            key={app.id}
            onClick={() => onLaunch(app.id)}
            className="vibe-startapp flex flex-col items-center gap-1.5 rounded-lg p-3 text-center transition-colors hover:bg-accent"
          >
            <AppIcon name={app.icon} presetId={app.presetId} label={app.name} className="size-7" />
            <span className="line-clamp-1 text-xs text-foreground/90">{app.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
