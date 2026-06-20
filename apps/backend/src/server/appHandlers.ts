import type { AppManifest } from "@vibeos/shared/domain";
import type { ClientToServerPayload } from "@vibeos/shared/protocol";
import { broadcast } from "./wsGateway.ts";
import { bus } from "../events/bus.ts";
import { ensureTransientApp, getApp, installApp } from "../db/repositories/AppRepo.ts";
import { openWindow, getWindow } from "../db/repositories/WindowRepo.ts";
import { ensureMemory, getSnapshot } from "../db/repositories/AppMemoryRepo.ts";
import { ensureShortcut, createNode } from "../db/repositories/VfsRepo.ts";
import { logger } from "../util/log.ts";

const log = logger("router");

/** Spawn a fresh window (or desktop widget) and generate its content live. */
export async function handleAppLaunch(p: ClientToServerPayload<"c2s.app.launch">): Promise<void> {
  const appId = await ensureTransientApp();
  const widget = !!p.widget;
  const w = await openWindow({
    appId,
    title: p.name,
    kind: widget ? "widget" : "app",
    rect: widget ? { x: 60, y: 60, w: 320, h: 260 } : { x: 140, y: 90, w: 820, h: 580 },
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
  const win = getWindow(p.windowId);
  if (!win) return;
  const snapshot = getSnapshot(p.windowId);
  if (!snapshot.trim()) {
    broadcast("s2c.error", { code: "ai_failed", detail: "nothing to save yet", windowId: win.id });
    return;
  }
  const src = getApp(win.appId);
  const name = (p.name ?? win.title ?? src?.name ?? "App").trim() || "App";
  const app = await installApp({
    name,
    icon: p.icon ?? src?.icon ?? "app-window",
    manifest: {
      description: src?.manifest.description,
      defaultSize: src?.manifest.defaultSize,
      seedHtml: snapshot,
    },
  });
  const shortcut = await ensureShortcut(app.id, app.name, app.icon);
  broadcast("s2c.syscall.appInstalled", { app, shortcut: shortcut ?? undefined });
  log.info(`saved window [${win.id.slice(-6)}] as app "${name}"`);
}

/** Export an installed app to a shareable .vibeapp file on the desktop. */
export async function handleAppExport(p: ClientToServerPayload<"c2s.app.export">): Promise<void> {
  const app = getApp(p.appId);
  if (!app) return;
  const data = JSON.stringify(
    { vibeapp: 1, name: app.name, icon: app.icon, manifest: app.manifest },
    null,
    2,
  );
  const node = await createNode({
    name: `${app.name}.vibeapp`,
    type: "file",
    mime: "application/vibeapp+json",
    content: data,
    location: "desktop",
  });
  broadcast("s2c.syscall.fileCreated", { node });
  log.info(`exported app "${app.name}" → ${node.name}`);
}

/** Import an app from a .vibeapp JSON string. */
export async function handleAppImport(p: ClientToServerPayload<"c2s.app.import">): Promise<void> {
  type VibeApp = { name?: string; icon?: string; manifest?: AppManifest };
  let data: VibeApp | null = null;
  try {
    data = JSON.parse(p.json) as VibeApp;
  } catch {
    /* ignore */
  }
  if (!data || typeof data.name !== "string" || !data.name.trim()) {
    broadcast("s2c.error", { code: "bad_json" });
    return;
  }
  const app = await installApp({ name: data.name, icon: data.icon, manifest: data.manifest ?? {} });
  const shortcut = await ensureShortcut(app.id, app.name, app.icon);
  broadcast("s2c.syscall.appInstalled", { app, shortcut: shortcut ?? undefined });
  log.info(`imported app "${app.name}"`);
}
