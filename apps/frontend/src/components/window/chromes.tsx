import type { FC, ReactNode } from "react";
import { BrowserChrome } from "./BrowserChrome";

/**
 * Native chrome shells, keyed by AppManifest.chrome. Each wraps the AI content
 * with persistent native UI and a reverse channel (the `chrome` syscall).
 */
export const CHROMES: Record<string, FC<{ windowId: string; children: ReactNode }>> = {
  browser: BrowserChrome,
};
