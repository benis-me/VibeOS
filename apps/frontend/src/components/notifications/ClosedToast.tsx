import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { useClosedStore } from "@/lib/windowClose";
import { EASE_OUT, EXIT } from "@/lib/motion";
import { buttonVariants } from "@/components/ui/button";

/** "Closed: X · Undo" for five seconds after the user closes a generated window. */
export function ClosedToast() {
  const t = useT();
  const reduced = useReducedMotion();
  const closed = useClosedStore((s) => s.closed);
  useEffect(() => {
    if (!closed) return;
    const timer = setTimeout(() => useClosedStore.setState({ closed: null }), 5000);
    return () => clearTimeout(timer);
  }, [closed]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[9999] flex justify-center"
      style={{ bottom: "calc(var(--taskbar-h) + 28px)" }}
    >
      <AnimatePresence>
        {closed && (
          <motion.div
            key={closed.windowId}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={
              reduced
                ? { opacity: 0, transition: EXIT }
                : { opacity: 0, filter: "blur(2px)", transition: EXIT }
            }
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="vibe-closed pointer-events-auto flex items-center gap-3 rounded-xl border bg-popover/95 py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-popover backdrop-blur"
          >
            <span className="max-w-72 truncate">
              {t("win.closedNotice")}: {closed.title}
            </span>
            <button
              type="button"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              onClick={() => {
                wsClient.send("c2s.window.reopen", { windowId: closed.windowId });
                useClosedStore.setState({ closed: null });
              }}
            >
              {t("win.undoClose")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
