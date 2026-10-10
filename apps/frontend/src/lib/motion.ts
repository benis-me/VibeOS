import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";

/**
 * Shared motion config. Principles (Emil Kowalski): ease-out by default, UI
 * animations under 300ms, animate only transform + opacity, never scale from 0,
 * and respect prefers-reduced-motion (fall back to a plain opacity fade).
 */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** Leaving is the user's decision: half the entrance, accelerating away. */
export const EXIT: Transition = { duration: 0.12, ease: "easeIn" };

type Variants = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
};

/** Popovers / menus: subtle scale + fade. Pair with an origin-* class. */
export function usePopoverMotion(): Variants {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0, transition: EXIT },
      transition: { duration: 0.12 },
    };
  }
  return {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96, transition: EXIT },
    transition: { duration: 0.18, ease: EASE_OUT },
  };
}

/** Windows opening/closing: gentle scale + fade from center. */
export function useWindowMotion(): Variants {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0, transition: EXIT },
      transition: { duration: 0.12 },
    };
  }
  return {
    initial: { opacity: 0, scale: 0.97 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98, transition: EXIT },
    transition: { duration: 0.16, ease: EASE_OUT },
  };
}

/**
 * A number that moves to each new value instead of jumping, so a live readout
 * reads as a change rather than two facts. Shows the value as-is on first render
 * and under reduced motion.
 */
export function useTweened(target: number, duration = 0.6): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (reduced) {
      current.current = target;
      setShown(target);
      return;
    }
    const tween = animate(current.current, target, {
      duration,
      ease: EASE_OUT,
      onUpdate: (value) => {
        current.current = value;
        setShown(value);
      },
    });
    return () => tween.stop();
  }, [target, duration, reduced]);
  return reduced ? target : shown;
}
