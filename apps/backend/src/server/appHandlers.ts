import { saveWindowAsApplication } from "../db/repositories/ApplicationRepo.ts";
import { handleApplicationCommand } from "../ai/applications.ts";
import { getWindow as currentWindow } from "../db/repositories/WindowRepo.ts";
import type { ClientToServerPayload } from "@vibeos/shared/protocol";
import { broadcast } from "./wsGateway.ts";
import { bus } from "../events/bus.ts";
import { getApp, installApp } from "../db/repositories/AppRepo.ts";
import { openWindow } from "../db/repositories/WindowRepo.ts";
import { ensureMemory } from "../db/repositories/AppMemoryRepo.ts";
import { ensureShortcut } from "../db/repositories/VfsRepo.ts";
import { logger } from "../util/log.ts";

const log = logger("router");

export async function handleAppShortcut(
  p: ClientToServerPayload<"c2s.app.shortcut">,
): Promise<void> {
  const app = getApp(p.appId);
  if (!app?.isInstalled) return;
  const node = await ensureShortcut(app.id, app.name, app.icon);
  if (node) broadcast("s2c.vfs.changed", { node });
  broadcast("s2c.files.changed", {});
}

/** Spawn a fresh window (or desktop widget) and generate its content live. */
export async function handleAppLaunch(p: ClientToServerPayload<"c2s.app.launch">): Promise<void> {
  const draft = await installApp({
    name: p.name,
    icon: p.icon,
    isInstalled: false,
    manifest: {
      description: p.description ?? p.name,
      instructions: p.description ?? p.name,
      defaultSize: p.size,
    },
  });
  const appId = draft.id;
  broadcast("s2c.syscall.appInstalled", { app: draft });
  const widget = !!p.widget;
  const size = p.size ?? (widget ? { w: 320, h: 260 } : { w: 820, h: 580 });
  const w = await openWindow({
    appId,
    title: p.name,
    kind: widget ? "widget" : "app",
    rect: { x: widget ? 60 : 140, y: widget ? 60 : 90, ...size },
  });
  await ensureMemory(w.id, appId);
  broadcast("s2c.window.opened", { window: w });
  const seed = widget
    ? `Generate a compact desktop WIDGET called "${p.name}".${
        p.description ? ` It is: ${p.description}.` : ""
      } It must be a small, glanceable, self-contained panel WITHOUT any window chrome that fills its area (e.g. a clock, weather, stocks, a mini to-do or player). It sits on a FROSTED-GLASS surface: use a fully TRANSPARENT background (no opaque page/container background — at most subtle translucent layers), and high-contrast, legible text and icons that read clearly over a blurred backdrop. Keep it minimal and visually striking.`
    : `Generate the application "${p.name}".${
        p.description ? ` It is: ${p.description}.` : ""
      } Produce a complete, believable, fully usable first screen for this app.`;
  log.info(`launch ${widget ? "widget" : "app"} "${p.name}" → window [${w.id.slice(-6)}]`);
  bus.emit("window.spawnRender", { windowId: w.id, seedPrompt: seed });
}

/** Freeze a window's current UI as a reusable installed app (+ desktop shortcut). */
export async function handleAppSave(p: ClientToServerPayload<"c2s.app.save">): Promise<void> {
  const app = await saveWindowAsApplication(p.windowId, p.name, p.icon);
  const shortcut = await ensureShortcut(app.id, app.name, app.icon);
  broadcast("s2c.syscall.appInstalled", { app, shortcut: shortcut ?? undefined });
  broadcast("s2c.window.stateChanged", { window: currentWindow(p.windowId)! });
  await handleApplicationCommand({ action: "state" });
}

/** Export an installed app to a shareable .vibeapp file on the desktop. */
export async function handleAppExport(p: ClientToServerPayload<"c2s.app.export">): Promise<void> {
  await handleApplicationCommand({ action: "export", appId: p.appId });
}

/** Import an app from a .vibeapp JSON string. */
export async function handleAppImport(p: ClientToServerPayload<"c2s.app.import">): Promise<void> {
  await handleApplicationCommand({ action: "import", json: p.json });
}
