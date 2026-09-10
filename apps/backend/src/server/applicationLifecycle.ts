import { getApp } from "../db/repositories/AppRepo.ts";
import {
  readApplicationVersion,
  getAppData,
  applicationPath,
  retireApplication,
} from "../db/repositories/ApplicationRepo.ts";
import {
  listOpenWindows,
  getWindow,
  closeWindow,
  openWindow,
} from "../db/repositories/WindowRepo.ts";
import { ensureMemory } from "../db/repositories/AppMemoryRepo.ts";
import { mutateDisk } from "../db/repositories/VfsRepo.ts";
import { broadcast } from "./wsGateway.ts";
import { bus } from "../events/bus.ts";
import { renderInitialWindow } from "../kernel/windowInit.ts";

export async function uninstallApplication(appId: string) {
  const app = getApp(appId);
  if (!app || app.kind !== "virtual") throw new Error("applications.error.readOnly");
  const path = applicationPath(appId);
  for (const window of listOpenWindows().filter((w) => w.appId === appId)) {
    bus.emit("window.closed", { windowId: window.id });
    await closeWindow(window.id);
    broadcast("s2c.window.closed", { windowId: window.id });
  }
  const moved = await mutateDisk({ action: "trash", path });
  for (const node of moved.nodes) broadcast("s2c.vfs.changed", { node });
  if (moved.removed.length) broadcast("s2c.vfs.removed", { ids: moved.removed });
  await retireApplication(appId);
}

export async function updateApplicationWindow(windowId: string) {
  const original = getWindow(windowId),
    app = original ? getApp(original.appId) : null;
  if (!original?.isOpen || !app || app.kind !== "virtual")
    throw new Error("applications.error.window");
  const definition = readApplicationVersion(app.id)!;
  if (definition.dataSchemaVersion !== getAppData(app.id).schemaVersion)
    throw new Error("applications.error.schema");
  // A new version opens alongside the old window, retaining every unsaved local field.
  const window = await openWindow({
    appId: app.id,
    title: app.name,
    kind: "app",
    size: app.manifest.defaultSize,
    filePath: original.filePath,
  });
  await ensureMemory(window.id, app.id);
  broadcast("s2c.window.opened", { window });
  await renderInitialWindow(window.id, app);
}
