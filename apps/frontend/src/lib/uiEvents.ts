/**
 * Lightweight window-level events for shell-wide UI actions that a deeply-nested
 * component (e.g. a native app window) needs to trigger on the Desktop, without
 * threading callbacks through every layer.
 */
export const OPEN_SPOTLIGHT_EVENT = "vibe:open-spotlight";

export interface OpenSpotlightDetail {
  /** Prefill the Spotlight input (e.g. "> make a calculator" for command mode). */
  query?: string;
}

/** Ask the Desktop to open Spotlight, optionally prefilled. */
export function requestSpotlight(query = ""): void {
  window.dispatchEvent(
    new CustomEvent<OpenSpotlightDetail>(OPEN_SPOTLIGHT_EVENT, { detail: { query } }),
  );
}
