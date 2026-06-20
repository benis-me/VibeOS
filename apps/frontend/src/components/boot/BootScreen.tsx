import { useConnectionStore } from "@/stores/connectionStore";
import { useT } from "@/lib/i18n";

export function BootScreen() {
  const phase = useConnectionStore((s) => s.bootPhase);
  const connected = useConnectionStore((s) => s.connected);
  const t = useT();
  const phaseLabel = t(`boot.${phase}`);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-6">
        <div className="text-3xl font-semibold tracking-tight">
          Vibe<span className="text-muted-foreground">OS</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span
            className={`size-2 rounded-full ${connected ? "bg-run glow-run breathe" : "bg-warn breathe"}`}
          />
          {phaseLabel}
        </div>
      </div>
    </div>
  );
}
