import { useMemo } from "react";
import { AnimatePresence } from "motion/react";
import { useWindowStore } from "@/stores/windowStore";
import { Window } from "./Window";

export function WindowManager() {
  const windows = useWindowStore((s) => s.windows);
  const list = useMemo(
    () => Object.values(windows).filter((w) => w.isOpen),
    [windows],
  );

  return (
    <AnimatePresence>
      {list.map((w) => (
        <Window key={w.id} win={w} />
      ))}
    </AnimatePresence>
  );
}
