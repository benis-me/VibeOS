import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCheck } from "lucide-react";
import { useNotificationStore } from "@/stores/notificationStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { usePopoverMotion } from "@/lib/motion";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { cn } from "@/lib/utils";

const TRIGGER = '[data-popover-trigger="notifications"]';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NotificationCenter({ open, onClose }: Props) {
  const notifications = useNotificationStore((s) => s.notifications);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const panel = usePopoverMotion();
  const anchor = useAnchoredPopover(open, TRIGGER, "right", 384);

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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          {...panel}
          style={anchor}
          className="vibe-notif z-[9999] flex max-h-[70vh] w-96 origin-bottom-right flex-col rounded-xl border bg-popover/95 shadow-2xl backdrop-blur sheen"
        >
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-sm font-medium">{t("notif.title")}</span>
        <button
          onClick={() => wsClient.send("c2s.notification.read", { id: "all" })}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <CheckCheck className="size-3.5" /> {t("notif.markAllRead")}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {notifications.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("notif.empty")}</div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                wsClient.send("c2s.notification.click", { id: n.id });
                onClose();
              }}
              className={cn(
                "flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
                !n.read && "bg-accent/40",
              )}
            >
              <div className="flex w-full items-center gap-2">
                {!n.read && <span className="size-1.5 rounded-full bg-brand" />}
                <span className="flex-1 truncate text-sm font-medium">{n.title}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {n.body && <span className="mt-0.5 text-xs text-muted-foreground">{n.body}</span>}
            </button>
          ))
        )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
