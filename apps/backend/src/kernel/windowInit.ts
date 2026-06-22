import type { AppDescriptor } from "@vibeos/shared/domain";
import { NATIVE_PRESET_APPS } from "@vibeos/shared/domain";
import { broadcast } from "../server/wsGateway.ts";
import { bus } from "../events/bus.ts";
import { saveSnapshot, ensureMemory } from "../db/repositories/AppMemoryRepo.ts";
import { getApp } from "../db/repositories/AppRepo.ts";
import { openWindow } from "../db/repositories/WindowRepo.ts";
import { logger } from "../util/log.ts";

const log = logger("boot");

/**
 * Decide how a freshly-opened window gets its first content:
 *  - native preset app (Settings / Activity Monitor / App Store) → nothing (React renders it)
 *  - app with a frozen `seedHtml` → push that snapshot immediately
 *  - otherwise → an AI first render
 */
export async function renderInitialWindow(windowId: string, app: AppDescriptor): Promise<void> {
  if (app.presetId && NATIVE_PRESET_APPS.includes(app.presetId)) return;

  const seed = typeof app.manifest.seedHtml === "string" ? app.manifest.seedHtml : "";
  if (seed.trim()) {
    await saveSnapshot(windowId, seed);
    broadcast("s2c.ui.patch", { windowId, mode: "full", html: seed, done: true });
    return;
  }

  bus.emit("window.firstRender", { windowId });
}

/**
 * Cold start: on the very first boot, open the Welcome app so a fresh desktop
 * isn't empty. It's a normal native window — left open it persists across
 * refreshes/reboots, and once the user closes it it stays closed (no separate
 * "seen" flag needed). Runs before any client connects, so no broadcast.
 */
export async function openWelcomeOnFirstBoot(): Promise<void> {
  const app = getApp("welcome");
  if (!app) return;
  const w = await openWindow({
    appId: "welcome",
    title: app.name,
    kind: "system",
    size: app.manifest.defaultSize,
  });
  await ensureMemory(w.id, "welcome");
  log.info("first boot — opened Welcome window");
}
