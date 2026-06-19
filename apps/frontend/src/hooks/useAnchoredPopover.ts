import { useLayoutEffect, useState, type CSSProperties } from "react";

/**
 * Position a popover above its trigger button (found by selector), so it follows
 * the button wherever a skin puts it (taskbar corner, centered Dock, …). Returns
 * a fixed-position style; recomputes on open and on resize.
 *
 * Pair with skipping the same selector in the popover's outside-click handler so
 * clicking the trigger toggles it closed instead of close-then-reopen.
 */
export function useAnchoredPopover(
  open: boolean,
  triggerSelector: string,
  align: "left" | "right",
  width = 320,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = document.querySelector(triggerSelector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const bottom = Math.round(window.innerHeight - r.top + 8);
      if (align === "left") {
        const left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8)));
        setStyle({ position: "fixed", left, bottom, top: "auto", right: "auto" });
      } else {
        const right = Math.round(Math.max(8, window.innerWidth - r.right));
        setStyle({ position: "fixed", right, bottom, top: "auto", left: "auto" });
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, triggerSelector, align, width]);
  return style;
}
