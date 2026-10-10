import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import type { Notification, NotificationKind } from "@vibeos/shared";
import { useNotificationStore } from "@/stores/notificationStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { EASE_OUT, EXIT } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const NOTIFICATION_ICON: Record<NotificationKind, React.ReactNode> = {
  info: <Info className="size-4 text-muted-foreground" />,
  success: <CheckCircle2 className="size-4 text-run" />,
  warning: <AlertTriangle className="size-4 text-warn" />,
  error: <XCircle className="size-4 text-destructive" />,
};

function Toast({ n }: { n: Notification }) {
  const dismiss = useNotificationStore((s) => s.dismissToast);
  const reduced = useReducedMotion();
  const t = useT();
  // Errors and toasts with an action wait to be dismissed, so they cannot be missed.
  const sticky = n.kind === "error" || !!n.action;
  useEffect(() => {
    if (sticky) return;
    const timer = setTimeout(() => dismiss(n.id), 5200);
    return () => clearTimeout(timer);
  }, [n.id, dismiss, sticky]);

  const offset = reduced ? 0 : 16;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: offset }}
      animate={{ opacity: 1, x: 0 }}
      // Arrives with direction; leaves in place, quicker and softer than it came.
      exit={
        reduced
          ? { opacity: 0, transition: EXIT }
          : { opacity: 0, filter: "blur(2px)", transition: EXIT }
      }
      transition={{ duration: 0.2, ease: EASE_OUT }}
      role={n.kind === "error" ? "alert" : undefined}
      className={cn(
        "vibe-notif pointer-events-auto w-80 rounded-xl border bg-card/95 p-3 shadow-popover inset-shadow-sheen backdrop-blur",
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* The card opens what it refers to; the X beside it only dismisses. */}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => {
            wsClient.send("c2s.notification.click", { id: n.id });
            dismiss(n.id);
          }}
        >
          <span className="mt-0.5">{NOTIFICATION_ICON[n.kind]}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{n.title}</span>
            {n.body && (
              <span className="mt-0.5 block text-pretty text-xs text-muted-foreground">
                {n.body}
              </span>
            )}
            {n.action && (
              <span className="mt-1.5 block text-xs font-medium text-brand">{n.action.label}</span>
            )}
          </span>
        </button>
        <button
          type="button"
          aria-label={t("communication.dismiss")}
          title={t("communication.dismiss")}
          onClick={() => dismiss(n.id)}
          className="-m-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

export function NotificationToasts() {
  const toasts = useNotificationStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute right-3 top-3 z-[9999] flex flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.slice(-4).map((n) => (
          <Toast key={n.id} n={n} />
        ))}
      </AnimatePresence>
    </div>
  );
}
