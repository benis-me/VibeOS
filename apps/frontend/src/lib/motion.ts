import { useReducedMotion } from "motion/react";

/**
 * Shared motion config. Principles (Emil Kowalski): ease-out by default, UI
 * animations under 300ms, animate only transform + opacity, never scale from 0,
 * and respect prefers-reduced-motion (fall back to a plain opacity fade).
 */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

type Variants = {
  initial: Record<string, number>;
  animate: Record<string, number>;
  exit: Record<string, number>;
  transition: { duration: number; ease?: [number, number, number, number] };
};

/** Popovers / menus: subtle scale + fade. Pair with an origin-* class. */
export function usePopoverMotion(): Variants {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.12 },
    };
  }
  return {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
    transition: { duration: 0.18, ease: EASE_OUT },
  };
}

/** Backdrops / overlays: plain fade. */
export function useOverlayMotion(): Variants {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.15 },
  };
}

/** Windows opening/closing: gentle scale + fade from center. */
export function useWindowMotion(): Variants {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.12 },
    };
  }
  return {
    initial: { opacity: 0, scale: 0.97 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
    transition: { duration: 0.16, ease: EASE_OUT },
  };
}
