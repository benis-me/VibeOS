import { useBoot } from "@/hooks/useBoot";
import { useConnectionStore } from "@/stores/connectionStore";
import { BootScreen } from "@/components/boot/BootScreen";
import { Desktop } from "@/components/desktop/Desktop";
import { useT } from "@/lib/i18n";

export function App() {
  useBoot();
  const phase = useConnectionStore((s) => s.bootPhase);
  const booted = useConnectionStore((s) => s.hasBooted);
  const t = useT();

  if (!booted) {
    return <BootScreen />;
  }
  // After the first boot a lost connection (e.g. a backend restart) keeps the
  // desktop mounted, so drafts and unsaved edits survive; a thin bar says why.
  return (
    <>
      <Desktop />
      {phase !== "ready" && (
        <div className="pointer-events-none fixed inset-x-0 top-2 z-[10002] flex justify-center">
          <div
            role="status"
            className="vibe-reconnect flex items-center gap-2 rounded-full border bg-popover/95 px-3 py-1 text-xs text-muted-foreground shadow-lg backdrop-blur"
          >
            <span className="size-1.5 rounded-full bg-warn breathe" />
            {phase === "connecting" ? t("boot.reconnecting") : t(`boot.${phase}`)}
          </div>
        </div>
      )}
    </>
  );
}
