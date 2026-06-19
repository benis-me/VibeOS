import type { Syscall } from "@vibeos/shared/domain";
import { broadcast } from "../server/wsGateway.ts";
import { bus } from "../events/bus.ts";
import * as NotificationRepo from "../db/repositories/NotificationRepo.ts";
import * as AppRepo from "../db/repositories/AppRepo.ts";
import * as VfsRepo from "../db/repositories/VfsRepo.ts";
import {
  findOpenWindowByApp,
  openWindow,
  focusWindow,
  closeWindow,
} from "../db/repositories/WindowRepo.ts";
import { ensureMemory } from "../db/repositories/AppMemoryRepo.ts";
import { renderInitialWindow } from "../kernel/windowInit.ts";
import { logger } from "../util/log.ts";

const log = logger("syscall");

export interface SyscallContext {
  /** Window that produced these syscalls (for source attribution). */
  windowId?: string;
  appId?: string;
  source: "syscall" | "agent" | "system";
}

export async function execute(calls: Syscall[], ctx: SyscallContext): Promise<void> {
  for (const call of calls) {
    try {
      log.info(`exec ${call.type}`, call);
      await one(call, ctx);
    } catch (e) {
      log.error(`failed ${call.type}`, e instanceof Error ? e.message : e);
    }
  }
}

async function one(call: Syscall, ctx: SyscallContext): Promise<void> {
  switch (call.type) {
    case "notify": {
      const notification = await NotificationRepo.create({
        kind: call.kind ?? "info",
        title: call.title,
        body: call.body,
        appId: ctx.appId,
        source: ctx.source,
      });
      broadcast("s2c.syscall.notify", { notification });
      return;
    }

    case "open": {
      const app = AppRepo.getApp(call.appId);
      if (!app) return;
      if (app.manifest.singleInstance) {
        const existing = findOpenWindowByApp(app.id);
        if (existing) {
          const w = await focusWindow(existing.id);
          if (w) broadcast("s2c.window.focused", { windowId: w.id });
          return;
        }
      }
      const w = await openWindow({
        appId: app.id,
        title: app.name,
        kind: app.presetId ? "system" : "app",
        size: app.manifest.defaultSize,
      });
      await ensureMemory(w.id, app.id);
      broadcast("s2c.window.opened", { window: w });
      await renderInitialWindow(w.id, app);
      return;
    }

    case "spawn-window": {
      // Pop up a new window and generate its content from the given prompt.
      // Anchor it to: explicit appId → source app → a generic transient app.
      let appId = call.appId ?? ctx.appId;
      if (!appId || !AppRepo.getApp(appId)) {
        appId = await AppRepo.ensureTransientApp();
      }
      const w = await openWindow({
        appId,
        title: call.title,
        kind: "app",
        rect: {
          x: 130,
          y: 100,
          w: call.width ?? 640,
          h: call.height ?? 460,
        },
      });
      await ensureMemory(w.id, appId);
      broadcast("s2c.window.opened", { window: w });
      bus.emit("window.spawnRender", { windowId: w.id, seedPrompt: call.prompt });
      log.info(`spawned window "${call.title}" [${w.id.slice(-6)}]`);
      return;
    }

    case "install": {
      const app = await AppRepo.installApp({
        name: call.name,
        icon: call.icon,
        manifest: call.manifest,
      });
      const shortcut = await VfsRepo.ensureShortcut(app.id, app.name, app.icon);
      broadcast("s2c.syscall.appInstalled", { app, shortcut: shortcut ?? undefined });
      return;
    }

    case "create-file": {
      const node = await VfsRepo.createNode({
        name: call.name,
        type: "file",
        mime: call.mime,
        content: call.content,
        location: call.location ?? "desktop",
      });
      broadcast("s2c.syscall.fileCreated", { node });
      return;
    }

    case "focus": {
      const w = await focusWindow(call.windowId);
      if (w) broadcast("s2c.window.focused", { windowId: w.id });
      return;
    }

    case "close": {
      bus.emit("window.closed", { windowId: call.windowId });
      await closeWindow(call.windowId);
      broadcast("s2c.window.closed", { windowId: call.windowId });
      return;
    }
  }
}
