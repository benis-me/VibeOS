import { useBoot } from "@/hooks/useBoot";
import { useConnectionStore } from "@/stores/connectionStore";
import { BootScreen } from "@/components/boot/BootScreen";
import { Desktop } from "@/components/desktop/Desktop";

export function App() {
  useBoot();
  const phase = useConnectionStore((s) => s.bootPhase);

  if (phase !== "ready") {
    return <BootScreen />;
  }
  return <Desktop />;
}
