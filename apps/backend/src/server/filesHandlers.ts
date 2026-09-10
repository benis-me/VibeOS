import type { ServerWebSocket } from "bun";
import type { ClientToServerPayload } from "@vibeos/shared/protocol";
import { executeDisk, diskError, diskPath } from "../files/disk.ts";
import { broadcast, sendTo, type WsData } from "./wsGateway.ts";
import { lstatSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileMediaType, MAX_SKIN_PACKAGE_BYTES, type DiskResult } from "@vibeos/shared/domain";
import { handleSkinCommand } from "../ai/skins.ts";
import { allowedOrigin } from "./requestOrigin.ts";
import { mutateDisk, syncDesktopFiles } from "../db/repositories/VfsRepo.ts";
import { readShortcut } from "../files/shortcuts.ts";
import { renderInitialWindow } from "../kernel/windowInit.ts";
import { getApp } from "../db/repositories/AppRepo.ts";
import { ensureMemory } from "../db/repositories/AppMemoryRepo.ts";
import {
  listOpenWindows,
  openWindow,
  findOpenWindowByApp,
  focusWindow,
} from "../db/repositories/WindowRepo.ts";

/** Shared file dispatch: native viewers for content, normal app launch for shortcuts. */
export async function openDiskFile(path: string) {
  const absolute = diskPath(path);
  const info = lstatSync(absolute);
  if (!info.isFile()) throw new Error("notFile");
  const skinFile = path.toLowerCase().endsWith(".vibeskin");
  if (skinFile) {
    if (info.size > MAX_SKIN_PACKAGE_BYTES) throw new Error("skins.error.packageSize");
    await handleSkinCommand({ action: "import", json: readFileSync(absolute, "utf8") });
  }
  const shortcut = path.toLowerCase().endsWith(".vibelink") ? readShortcut(absolute) : undefined;
  const appId = skinFile
    ? "skins"
    : (shortcut?.appId ?? (fileMediaType(path) ? "media-viewer" : "text-viewer"));
  const app = getApp(appId);
  if (!app?.isInstalled) throw new Error("missingApp");
  const existing = app.manifest.singleInstance ? findOpenWindowByApp(appId) : null;
  if (existing) {
    await focusWindow(existing.id);
    broadcast("s2c.window.focused", { windowId: existing.id });
    return existing;
  }
  const window = await openWindow({
    appId,
    title: shortcut || skinFile ? app.name : basename(path),
    kind: app.presetId ? "system" : "app",
    size: app.manifest.defaultSize,
    filePath: shortcut || skinFile ? undefined : path,
  });
  await ensureMemory(window.id, appId);
  broadcast("s2c.window.opened", { window });
  if (shortcut || skinFile) await renderInitialWindow(window.id, app);
  return window;
}

export async function broadcastDiskChanges() {
  const { nodes, removed } = await syncDesktopFiles();
  for (const node of nodes) broadcast("s2c.vfs.changed", { node });
  if (removed.length) broadcast("s2c.vfs.removed", { ids: removed });
  broadcast("s2c.files.changed", {});
}

export function broadcastFileWindows() {
  for (const window of listOpenWindows()) {
    if (window.filePath) broadcast("s2c.window.stateChanged", { window });
  }
}

/** Same real-file operations for Files, native viewers and app messages. */
export async function executeFileCommand(
  command: ClientToServerPayload<"c2s.files.request">["command"],
  beforeWrite = () => {},
): Promise<DiskResult & { windowId?: string }> {
  beforeWrite();
  if (command.action === "open") {
    const window = await openDiskFile(command.path);
    return { path: command.path, windowId: window.id };
  }
  const readOnly =
    command.action === "list" || command.action === "read" || command.action === "stat";
  const { result, nodes, removed } = readOnly
    ? { result: executeDisk(command), nodes: [], removed: [] }
    : await mutateDisk(command, beforeWrite);
  for (const node of nodes) broadcast("s2c.vfs.changed", { node });
  if (removed.length) broadcast("s2c.vfs.removed", { ids: removed });
  if (!readOnly) {
    broadcastFileWindows();
    broadcast("s2c.files.changed", {
      paths: [
        command.path,
        ...("destination" in command ? [command.destination] : []),
        ...(result.path ? [result.path] : []),
      ],
    });
  }
  return { path: command.path, ...result };
}

export async function handleFilesRequest(
  ws: ServerWebSocket<WsData>,
  payload: ClientToServerPayload<"c2s.files.request">,
): Promise<void> {
  try {
    const result = await executeFileCommand(payload.command);
    sendTo(ws, "s2c.files.result", { requestId: payload.requestId, result });
  } catch (error) {
    sendTo(ws, "s2c.files.result", {
      requestId: payload.requestId,
      result: { error: diskError(error) },
    });
  }
}

/** Bun.file streams downloads and handles byte ranges for audio/video seeking. */
export async function serveDiskFile(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET" || !allowedOrigin(req))
    return new Response("Forbidden", { status: 403 });
  try {
    const path = url.searchParams.get("path") ?? "";
    if (!path) return new Response("Not found", { status: 404 });
    const absolute = diskPath(path);
    if (!lstatSync(absolute).isFile()) return new Response("Not a file", { status: 400 });
    const file = Bun.file(absolute);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const preview = url.pathname.endsWith("/preview");
    const mime = fileMediaType(path);
    if (preview && !mime) return new Response("Unsupported preview", { status: 415 });
    return new Response(file, {
      headers: {
        "Content-Type": preview ? mime! : "application/octet-stream",
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(path.split("/").at(-1)!)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(diskError(error), { status: 400 });
  }
}
