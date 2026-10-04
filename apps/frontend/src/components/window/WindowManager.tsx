import { useMemo } from "react";
import { AnimatePresence } from "motion/react";
import { useWindowStore } from "@/stores/windowStore";
import { Window } from "./Window";

export function WindowManager() {
  const windows = useWindowStore((s) => s.windows);
  const list = useMemo(() => Object.values(windows).filter((w) => w.isOpen), [windows]);
  // The stored z only grows; stacking uses its rank, so windows never rise above the Dock.
  const layers = useMemo(
    () =>
      new Map(
        list
          .filter((w) => w.kind !== "widget")
          .sort((a, b) => a.z - b.z)
          .map((w, i) => [w.id, i + 1]),
      ),
    [list],
  );

  return (
    <AnimatePresence>
      {list.map((w) => (
        <Window key={w.id} win={w} layer={layers.get(w.id) ?? 0} />
      ))}
    </AnimatePresence>
  );
}
