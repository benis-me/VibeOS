import type { ServerWebSocket } from "bun";
import pkg from "../../package.json";
import type { ClientToServer, WsEnvelope } from "@vibeos/shared/protocol";
import { parseClientMessage } from "@vibeos/shared/protocol";
import type { AppManifest } from "@vibeos/shared/domain";
import { inferCapabilities, discoverAllProviders } from "../ai/modelDiscovery.ts";
import { sendTo, broadcast, type WsData } from "./wsGateway.ts";
import { bus } from "../events/bus.ts";
import { kernelState } from "../kernel/kernelState.ts";
import { ModelPolicy } from "../ai/ModelPolicy.ts";
import {
  setActiveProvider,
  activeProviderId,
  availableProviderIds,
  getProvider,
} from "../ai/providers/index.ts";
import { env } from "../config/env.ts";
import { searchApps } from "../ai/appSearch.ts";
import { runCommand } from "../ai/commandPalette.ts";
import * as Syscalls from "../syscall/SyscallInterpreter.ts";
import { requestWallpaper, storeUpload } from "../ai/imageCache.ts";
import { loadSettings, updateSettings } from "../db/repositories/SettingsRepo.ts";
import { listApps, getApp, ensureTransientApp, installApp } from "../db/repositories/AppRepo.ts";
import {
  listOpenWindows,
  openWindow,
  closeWindow,
  focusWindow,
  setWindowState,
  moveWindow,
  reorderWindows,
  rememberGeometry,
  findOpenWindowByApp,
  getWindow,
} from "../db/repositories/WindowRepo.ts";
import { ensureMemory, getSnapshot, getMemory } from "../db/repositories/AppMemoryRepo.ts";
import {
  listByLocation,
  moveNode,
  getNode,
  createNode,
  ensureShortcut,
  deleteNode,
  emptyRecycleBin,
} from "../db/repositories/VfsRepo.ts";
import { renderInitialWindow } from "../kernel/windowInit.ts";
import {
  listRecent,
  markRead,
  get as getNotification,
} from "../db/repositories/NotificationRepo.ts";
import { recentRuns } from "../db/repositories/AgentRepo.ts";
import { stopRun } from "../ai/SdkManager.ts";
import { logger } from "../util/log.ts";

const log = logger("router");

/** The latest in-flight app search per connection, so a new query preempts it. */
const appSearchAborts = new WeakMap<ServerWebSocket<WsData>, AbortController>();
/** The latest in-flight command per connection, so a new command preempts it. */
const commandAborts = new WeakMap<ServerWebSocket<WsData>, AbortController>();

export async function handleMessage(ws: ServerWebSocket<WsData>, raw: string): Promise<void> {
  let env: WsEnvelope<unknown>;
  try {
    env = JSON.parse(raw) as WsEnvelope<unknown>;
  } catch {
    log.warn("malformed frame", raw.slice(0, 120));
    sendTo(ws, "s2c.error", { code: "bad_json" });
    return;
  }
  const msg = parseClientMessage({ type: env.type, payload: env.payload });
  if (!msg) {
    log.warn(`rejected invalid message: ${String(env.type)}`);
    sendTo(ws, "s2c.error", { code: "bad_message", detail: String(env.type) });
    return;
  }
  log.debug(`◀ ${msg.type}`, msg.payload);
  const t0 = performance.now();
  try {
    await dispatch(ws, msg);
    log.debug(`✓ ${msg.type} (${(performance.now() - t0).toFixed(0)}ms)`);
  } catch (e) {
    log.error(`✗ ${msg.type}`, e instanceof Error ? e.stack : e);
    sendTo(ws, "s2c.error", {
      code: "internal",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

async function dispatch(ws: ServerWebSocket<WsData>, msg: ClientToServer): Promise<void> {
  switch (msg.type) {
    case "c2s.boot.hello":
      return sendBootState(ws);

    case "c2s.op":
      bus.emit("op.received", msg.payload);
      return;

    case "c2s.op.dragdrop":
      bus.emit("op.dragdrop", msg.payload);
      return;

    case "c2s.window.open":
      return handleOpen(msg.payload.appId);

    case "c2s.window.close": {
      bus.emit("window.closed", { windowId: msg.payload.windowId });
      await closeWindow(msg.payload.windowId);
      broadcast("s2c.window.closed", { windowId: msg.payload.windowId });
      return;
    }

    case "c2s.window.focus": {
      const w = await focusWindow(msg.payload.windowId);
      if (w) broadcast("s2c.window.focused", { windowId: w.id });
      return;
    }

    case "c2s.window.minimize": {
      const w = await setWindowState(msg.payload.windowId, "minimized");
      if (w) broadcast("s2c.window.stateChanged", { window: w });
      return;
    }

    case "c2s.window.maximize": {
      const cur = getWindow(msg.payload.windowId);
      const next = cur?.state === "maximized" ? "normal" : "maximized";
      const w = await setWindowState(msg.payload.windowId, next);
      if (w) broadcast("s2c.window.stateChanged", { window: w });
      return;
    }

    case "c2s.window.move": {
      const { windowId, x, y, w, h } = msg.payload;
      const win = await moveWindow(windowId, { x, y, w, h });
      if (win) {
        broadcast("s2c.window.moved", { window: win });
        // Remember geometry per real app (not transient launches or widgets) so
        // reopening the app restores its last size + position.
        if (win.kind !== "widget" && win.appId !== "__transient__") {
          await rememberGeometry(win.appId, { x, y, w, h });
        }
      }
      return;
    }

    case "c2s.window.reorder": {
      await reorderWindows(msg.payload.ids);
      broadcast("s2c.window.reordered", { ids: msg.payload.ids });
      return;
    }

    case "c2s.vfs.move": {
      const node = await moveNode(msg.payload);
      if (node) broadcast("s2c.vfs.changed", { node });
      return;
    }

    case "c2s.vfs.delete": {
      if (await deleteNode(msg.payload.nodeId)) {
        broadcast("s2c.vfs.removed", { ids: [msg.payload.nodeId] });
      }
      return;
    }

    case "c2s.vfs.empty": {
      const ids = await emptyRecycleBin();
      if (ids.length) broadcast("s2c.vfs.removed", { ids });
      return;
    }

    case "c2s.vfs.open": {
      const node = getNode(msg.payload.nodeId);
      if (node?.type === "shortcut" && node.targetAppId) {
        return handleOpen(node.targetAppId);
      }
      // Files open in a viewer app — for now open the file-manager focused on it.
      if (node) {
        return handleOpen("file-manager");
      }
      return;
    }

    case "c2s.settings.update": {
      const prevProvider = activeProviderId();
      const settings = await updateSettings(msg.payload.partial);
      broadcast("s2c.settings.changed", { settings });

      if (msg.payload.partial.provider && settings.provider !== prevProvider) {
        // Switching backends: activate it, then re-discover its models. Clear
        // the stale list immediately so Settings shows the "discovering" state.
        setActiveProvider(settings.provider);
        log.info(`AI provider → ${settings.provider}`);
        broadcast("s2c.models.updated", { models: [] });
        if (!env.aiStub) {
          void ModelPolicy.discover(settings.modelOverrides)
            .then(() => broadcast("s2c.models.updated", { models: ModelPolicy.available() }))
            .catch((e) =>
              log.warn(`model re-discovery failed: ${e instanceof Error ? e.message : e}`),
            );
        }
      } else if (msg.payload.partial.modelOverrides) {
        ModelPolicy.recompute(settings.modelOverrides);
      }
      return;
    }

    case "c2s.wallpaper.upload": {
      const path = await storeUpload(msg.payload.dataUrl);
      if (!path) {
        sendTo(ws, "s2c.error", { code: "wallpaper_bad_image" });
        return;
      }
      const settings = await updateSettings({ prefs: { wallpaper: path } });
      broadcast("s2c.settings.changed", { settings });
      return;
    }

    case "c2s.wallpaper.generate": {
      const path = requestWallpaper(msg.payload.prompt);
      if (!path) {
        sendTo(ws, "s2c.error", { code: "wallpaper_no_image_model" });
        return;
      }
      // The path serves once generation finishes (the /api/img route awaits it);
      // persist it now so the desktop swaps to it the moment it's ready.
      const settings = await updateSettings({ prefs: { wallpaper: path } });
      broadcast("s2c.settings.changed", { settings });
      return;
    }

    case "c2s.provider.scan": {
      // On-demand: re-detect which CLIs are installed and re-discover the active
      // provider's models. Availability is instant; models discover in the
      // background (clear the list first so Settings shows the scanning state).
      broadcast("s2c.providers.updated", { availableProviders: availableProviderIds() });
      if (!env.aiStub) {
        broadcast("s2c.models.updated", { models: [] });
        void ModelPolicy.discover(loadSettings().modelOverrides)
          .then(() => broadcast("s2c.models.updated", { models: ModelPolicy.available() }))
          .catch((e) => log.warn(`scan discovery failed: ${e instanceof Error ? e.message : e}`));
        // Re-discover every provider's models for the picker.
        discoverAllProviders();
      }
      return;
    }

    case "c2s.provider.fetchModels": {
      // Refresh one provider's model list and broadcast it. Discovered lists are
      // ephemeral (not persisted) so they never overwrite user-added models.
      const { providerId } = msg.payload;
      try {
        const provider = await getProvider(providerId);
        const discovered = await provider.discoverModels();
        broadcast("s2c.provider.models", {
          providerId,
          models: discovered.map((m) => ({
            id: m.modelId,
            name: m.name,
            capabilities: inferCapabilities(m.modelId),
          })),
        });
      } catch (e) {
        log.warn(`fetchModels(${providerId}) failed: ${e instanceof Error ? e.message : e}`);
        broadcast("s2c.provider.models", { providerId, models: [] });
      }
      return;
    }

    case "c2s.notification.read": {
      await markRead(msg.payload.id);
      broadcast("s2c.notification.read", { id: msg.payload.id });
      return;
    }

    case "c2s.notification.click": {
      await markRead(msg.payload.id);
      broadcast("s2c.notification.read", { id: msg.payload.id });
      const notif = getNotification(msg.payload.id);
      if (!notif) return;
      log.info(`notification clicked: "${notif.title}" (app=${notif.appId ?? "—"})`);
      const targetAppId = notif.action?.openAppId ?? notif.appId;
      if (targetAppId && getApp(targetAppId)) {
        // The notification belongs to an app → open/focus it and let that app
        // react to being opened from this notification.
        const windowId = await ensureOpenWindow(targetAppId);
        if (windowId) {
          bus.emit("op.received", {
            windowId,
            op: {
              kind: "custom",
              action: "open-notification",
              dataset: {
                notificationTitle: notif.title,
                notificationBody: notif.body ?? "",
                notificationId: notif.id,
              },
            },
          });
        }
      } else {
        // No associated app (most ambient/system notifications) → pop a fresh
        // window and let the AI generate whatever clicking this notification
        // should reveal, based on its content.
        const appId = await ensureTransientApp();
        const w = await openWindow({
          appId,
          title: notif.title,
          kind: "app",
          rect: { x: 150, y: 100, w: 640, h: 460 },
        });
        await ensureMemory(w.id, appId);
        broadcast("s2c.window.opened", { window: w });
        const seed = `The user clicked a system notification titled "${notif.title}"${
          notif.body ? ` with the message: "${notif.body}"` : ""
        }. Open the relevant screen that this notification leads to — e.g. the new email/message, the update details, the reminder, etc. Generate a complete, believable view for what opening this notification reveals.`;
        bus.emit("window.spawnRender", { windowId: w.id, seedPrompt: seed });
      }
      return;
    }

    case "c2s.app.search": {
      // Cancel this connection's previous in-flight search so fast typing doesn't
      // leave redundant AI generations running (the client debounces too, but a
      // new query that lands mid-generation should preempt the old one).
      appSearchAborts.get(ws)?.abort();
      const ctrl = new AbortController();
      appSearchAborts.set(ws, ctrl);
      const results = await searchApps(msg.payload.query, ctrl);
      if (ctrl.signal.aborted) return; // superseded — a newer search took over
      sendTo(ws, "s2c.app.searchResults", { requestId: msg.payload.requestId, results });
      return;
    }

    case "c2s.command.run": {
      // AI command palette: interpret the instruction into syscalls and run them.
      commandAborts.get(ws)?.abort();
      const ctrl = new AbortController();
      commandAborts.set(ws, ctrl);
      try {
        const calls = await runCommand(msg.payload.text, ctrl);
        if (ctrl.signal.aborted) return; // superseded
        await Syscalls.execute(calls, { source: "syscall" });
        sendTo(ws, "s2c.command.result", { requestId: msg.payload.requestId, count: calls.length });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        sendTo(ws, "s2c.command.result", {
          requestId: msg.payload.requestId,
          count: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    case "c2s.app.launch": {
      // Spawn a fresh window (or desktop widget) and generate it live.
      const appId = await ensureTransientApp();
      const widget = !!msg.payload.widget;
      const w = await openWindow({
        appId,
        title: msg.payload.name,
        kind: widget ? "widget" : "app",
        rect: widget ? { x: 60, y: 60, w: 320, h: 260 } : { x: 140, y: 90, w: 820, h: 580 },
      });
      await ensureMemory(w.id, appId);
      broadcast("s2c.window.opened", { window: w });
      const seed = widget
        ? `Generate a compact desktop WIDGET called "${msg.payload.name}".${
            msg.payload.description ? ` It is: ${msg.payload.description}.` : ""
          } It must be a small, glanceable, self-contained panel WITHOUT any window chrome that fills its area (e.g. a clock, weather, stocks, a mini to-do or player). It sits on a FROSTED-GLASS surface: use a fully TRANSPARENT background (no opaque page/container background — at most subtle translucent layers), and high-contrast, legible text and icons that read clearly over a blurred backdrop. Keep it minimal and visually striking.`
        : `Generate the application "${msg.payload.name}".${
            msg.payload.description ? ` It is: ${msg.payload.description}.` : ""
          } Produce a complete, believable, fully usable first screen for this app.`;
      log.info(
        `launch ${widget ? "widget" : "app"} "${msg.payload.name}" → window [${w.id.slice(-6)}]`,
      );
      bus.emit("window.spawnRender", { windowId: w.id, seedPrompt: seed });
      return;
    }

    case "c2s.app.save": {
      const win = getWindow(msg.payload.windowId);
      if (!win) return;
      const snapshot = getSnapshot(msg.payload.windowId);
      if (!snapshot.trim()) {
        broadcast("s2c.error", {
          code: "ai_failed",
          detail: "nothing to save yet",
          windowId: win.id,
        });
        return;
      }
      const src = getApp(win.appId);
      const name = (msg.payload.name ?? win.title ?? src?.name ?? "App").trim() || "App";
      const app = await installApp({
        name,
        icon: msg.payload.icon ?? src?.icon ?? "app-window",
        manifest: {
          description: src?.manifest.description,
          defaultSize: src?.manifest.defaultSize,
          seedHtml: snapshot,
        },
      });
      const shortcut = await ensureShortcut(app.id, app.name, app.icon);
      broadcast("s2c.syscall.appInstalled", { app, shortcut: shortcut ?? undefined });
      log.info(`saved window [${win.id.slice(-6)}] as app "${name}"`);
      return;
    }

    case "c2s.app.export": {
      const app = getApp(msg.payload.appId);
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
      return;
    }

    case "c2s.app.import": {
      type VibeApp = { name?: string; icon?: string; manifest?: AppManifest };
      let data: VibeApp | null = null;
      try {
        data = JSON.parse(msg.payload.json) as VibeApp;
      } catch {
        /* ignore */
      }
      if (!data || typeof data.name !== "string" || !data.name.trim()) {
        broadcast("s2c.error", { code: "bad_json" });
        return;
      }
      const app = await installApp({
        name: data.name,
        icon: data.icon,
        manifest: data.manifest ?? {},
      });
      const shortcut = await ensureShortcut(app.id, app.name, app.icon);
      broadcast("s2c.syscall.appInstalled", { app, shortcut: shortcut ?? undefined });
      log.info(`imported app "${app.name}"`);
      return;
    }

    case "c2s.activity.fetch": {
      const limit = Math.min(Math.max(msg.payload.limit ?? 40, 1), 100);
      const rows = recentRuns(limit + 1, msg.payload.before);
      const hasMore = rows.length > limit;
      sendTo(ws, "s2c.activity.page", { runs: rows.slice(0, limit), hasMore });
      return;
    }

    case "c2s.activity.stop": {
      stopRun(msg.payload.runId);
      return;
    }
  }
}

/** Open the app's window if not already open; returns the window id (or null). */
async function ensureOpenWindow(appId: string): Promise<string | null> {
  const app = getApp(appId);
  if (!app) {
    log.warn(`ensureOpenWindow: unknown app ${appId}`);
    return null;
  }
  const existing = findOpenWindowByApp(appId);
  if (existing) {
    const w = await focusWindow(existing.id);
    if (w) broadcast("s2c.window.focused", { windowId: w.id });
    return existing.id;
  }
  // No explicit rect → openWindow restores remembered geometry, else cascades.
  const w = await openWindow({
    appId,
    title: app.name,
    kind: app.presetId ? "system" : "app",
    size: app.manifest.defaultSize,
  });
  await ensureMemory(w.id, appId);
  broadcast("s2c.window.opened", { window: w });
  // No firstRender emit here — the caller will drive generation via an op.
  if (!getMemory(w.id)?.htmlSnapshot) bus.emit("window.firstRender", { windowId: w.id });
  return w.id;
}

async function handleOpen(appId: string): Promise<void> {
  const app = getApp(appId);
  if (!app) {
    broadcast("s2c.error", { code: "no_app", detail: appId });
    return;
  }
  // Single-instance apps focus their existing window; multi-instance apps
  // (browser / files / terminal / virtual apps) open a fresh window each time.
  if (app.manifest.singleInstance) {
    const existing = findOpenWindowByApp(appId);
    if (existing) {
      const w = await focusWindow(existing.id);
      if (w) broadcast("s2c.window.focused", { windowId: w.id });
      return;
    }
  }
  const w = await openWindow({
    appId,
    title: app.name,
    kind: app.presetId ? "system" : "app",
    size: app.manifest.defaultSize,
  });
  await ensureMemory(w.id, appId);
  broadcast("s2c.window.opened", { window: w });
  await renderInitialWindow(w.id, app);
}

function sendBootState(ws: ServerWebSocket<WsData>): void {
  const windows = listOpenWindows();
  const snapshots: Record<string, string> = {};
  for (const w of windows) snapshots[w.id] = getSnapshot(w.id);

  sendTo(ws, "s2c.boot.state", {
    phase: "ready",
    version: pkg.version,
    bootCount: kernelState.bootCount,
    settings: loadSettings(),
    windows,
    apps: listApps(),
    desktopNodes: listByLocation("desktop"),
    recycleBinNodes: listByLocation("recyclebin"),
    notifications: listRecent(),
    globalState: kernelState.get(),
    snapshots,
    models: ModelPolicy.available(),
    availableProviders: availableProviderIds(),
    agentRuns: recentRuns(),
  });
  sendTo(ws, "s2c.boot.ready", {});
  // Now the client is connected and listening: discover every provider's models
  // (all installed CLIs + configured APIs) and broadcast them for the picker.
  if (!env.aiStub) discoverAllProviders();
}
