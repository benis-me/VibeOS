import { useCallback } from "react";

/**
 * Ref for a scroller with the .vibe-fade-x / .vibe-fade-y mask: marks each edge
 * that still hides content (data-fade-start / data-fade-end), so only those fade.
 */
export function useScrollFade(axis: "x" | "y") {
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const update = () => {
        const at = axis === "x" ? el.scrollLeft : el.scrollTop;
        const max =
          axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
        // A pixel of slack: zoomed pages round these values differently.
        el.toggleAttribute("data-fade-start", at > 1);
        el.toggleAttribute("data-fade-end", at < max - 1);
      };
      update();
      el.addEventListener("scroll", update, { passive: true });
      // The scroller resizes, or its content grows (items added, a longer path).
      const resized = new ResizeObserver(update);
      resized.observe(el);
      const changed = new MutationObserver(update);
      changed.observe(el, { childList: true, subtree: true });
      return () => {
        el.removeEventListener("scroll", update);
        resized.disconnect();
        changed.disconnect();
      };
    },
    [axis],
  );
}
