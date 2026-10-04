import { useEffect } from "react";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { useClosedStore } from "@/lib/windowClose";
import { buttonVariants } from "@/components/ui/button";

/** "Closed: X · Undo" for five seconds after the user closes a generated window. */
export function ClosedToast() {
  const t = useT();
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
      {closed && (
        <div className="vibe-closed pointer-events-auto flex items-center gap-3 rounded-xl border bg-popover/95 py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-lg backdrop-blur">
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
        </div>
      )}
    </div>
  );
}
