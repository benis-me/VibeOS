import type { AppDescriptor } from "@vibeos/shared/domain";
import { NATIVE_PRESET_APPS } from "@vibeos/shared/domain";
import { broadcast } from "../server/wsGateway.ts";
import { bus } from "../events/bus.ts";
import { saveSnapshot } from "../db/repositories/AppMemoryRepo.ts";

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
