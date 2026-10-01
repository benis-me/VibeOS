import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import type { Notification, NotificationKind } from "@vibeos/shared";
import { useNotificationStore } from "@/stores/notificationStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

const ICON: Record<NotificationKind, React.ReactNode> = {
  info: <Info className="size-4 text-muted-foreground" />,
  success: <CheckCircle2 className="size-4 text-run" />,
  warning: <AlertTriangle className="size-4 text-warn" />,
  error: <XCircle className="size-4 text-destructive" />,
};

function Toast({ n }: { n: Notification }) {
  const dismiss = useNotificationStore((s) => s.dismissToast);
  const reduced = useReducedMotion();
  const t = useT();
  useEffect(() => {
    const timer = setTimeout(() => dismiss(n.id), 5200);
    return () => clearTimeout(timer);
  }, [n.id, dismiss]);

  const offset = reduced ? 0 : 16;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: offset }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: offset }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className={cn(
        "vibe-notif pointer-events-auto w-80 rounded-xl border bg-card/95 p-3 shadow-xl backdrop-blur sheen",
      )}
      onClick={() => {
        wsClient.send("c2s.notification.click", { id: n.id });
        dismiss(n.id);
      }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5">{ICON[n.kind]}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{n.title}</div>
          {n.body && <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>}
          {n.action && (
            <div className="mt-1.5 text-xs font-medium text-brand">{n.action.label}</div>
          )}
        </div>
        {/* Only dismisses: clicking the card itself opens what it refers to. */}
        <button
          type="button"
          aria-label={t("communication.dismiss")}
          title={t("communication.dismiss")}
          onClick={(e) => {
            e.stopPropagation();
            dismiss(n.id);
          }}
          className="-m-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
    <div className="pointer-events-none absolute right-3 top-3 z-[9999] flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.slice(-4).map((n) => (
          <Toast key={n.id} n={n} />
        ))}
      </AnimatePresence>
    </div>
  );
}
