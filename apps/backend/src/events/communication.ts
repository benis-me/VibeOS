import { getAppData, setAppData } from "../db/repositories/ApplicationRepo.ts";
import { z } from "zod";
import {
  communicationCommandSchema,
  messageDataSchema,
  MESSAGE_TIMEOUT,
  MESSAGE_BYTES,
  NATIVE_PRESET_APPS,
  skinIdSchema,
  type AppDelivery,
  type CommunicationCommand,
  type MessageData,
  type MessageSource,
  type MessageTarget,
  type MessageTrace,
  type AppSubscription,
  type Skin,
} from "@vibeos/shared";
import type { ServerToClient } from "@vibeos/shared/protocol";
import { diskCommandSchema } from "@vibeos/shared/protocol";
import { ulid } from "@vibeos/shared/util";
import { basename } from "node:path";
import { bus, messageContext } from "./bus.ts";
import { broadcast } from "../server/wsGateway.ts";
import { executeFileCommand, broadcastDiskChanges } from "../server/filesHandlers.ts";
import { getApp, listApps } from "../db/repositories/AppRepo.ts";
import { ensureMemory, getMemory } from "../db/repositories/AppMemoryRepo.ts";
import {
  listOpenWindows,
  getWindow,
  openWindow,
  focusWindow,
  setWindowFile,
} from "../db/repositories/WindowRepo.ts";
import {
  listSubscriptions,
  setSubscription,
  removeSubscription,
  recoverSubscriptions,
} from "../db/repositories/CommunicationRepo.ts";
import { loadSettings, updateSettings } from "../db/repositories/SettingsRepo.ts";
import { getSkin } from "../db/repositories/SkinRepo.ts";
import { handleSkinCommand } from "../ai/skins.ts";
import { renderInitialWindow } from "../kernel/windowInit.ts";
import { diskError } from "../files/disk.ts";
import { recordStep } from "../ai/SdkManager.ts";

type Pending = {
  canCommit: () => boolean;
  request: AppDelivery;
  sender: string;
  responseMode: "data" | "ai";
  channel?: string;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<string, Pending>();
const eventTimers = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; data: MessageData; trace?: MessageTrace }
>();
const opening = new Map<string, Promise<string>>();
let registered = false;
const object = (data: MessageData) =>
  data && typeof data === "object" && !Array.isArray(data) ? data : {};
export const communicationError = (error: unknown) => {
  if (error instanceof z.ZodError) return "communication.invalid";
  const text = error instanceof Error ? error.message : String(error);
  return /^(communication|files\.error|skins\.error|applications\.error)\.[a-zA-Z]+$/.test(text)
    ? text
    : "files.error." + diskError(error);
};
function sourceFor(windowId: string): MessageSource & { appId: string; windowId: string } {
  const window = getWindow(windowId);
  if (!window?.isOpen || !getApp(window.appId)) throw new Error("communication.closed");
  return { appId: window.appId, windowId };
}
function nextTrace(
  trace: MessageTrace | undefined,
  source: MessageSource,
  targetWindow?: string,
): MessageTrace {
  const next = trace
    ? { ...trace, windows: [...trace.windows], hops: trace.hops + 1 }
    : { id: ulid(), windows: "windowId" in source ? [source.windowId] : [], hops: 0 };
  if (next.hops >= 8 || (targetWindow && next.windows.includes(targetWindow)))
    throw new Error("communication.loop");
  if (targetWindow) next.windows.push(targetWindow);
  return next;
}
function deliver(delivery: AppDelivery) {
  if (!getWindow(delivery.windowId)?.isOpen || delivery.expiresAt <= Date.now()) return;
  broadcast("s2c.communication.delivery", { delivery });
  if (delivery.mode === "ai") bus.emit("app.delivery", { delivery });
}
const requestAlive = (id: string) => {
  const item = pending.get(id);
  return !!item && item.canCommit();
};
export function deliveryAlive(delivery: AppDelivery) {
  return (
    delivery.expiresAt > Date.now() &&
    (delivery.kind !== "request" || requestAlive(delivery.id)) &&
    (delivery.trace.requests ?? []).every(requestAlive)
  );
}
export function failDelivery(delivery: AppDelivery, error: string) {
  if (delivery.kind === "request") finish(delivery.id, null, error);
  else {
    const parent = [...(delivery.trace.requests ?? [])]
      .reverse()
      .find((id) => pending.get(id)?.request.windowId === delivery.windowId);
    if (parent) finish(parent, null, error);
  }
}
export function pendingReplies(windowId: string, trace?: MessageTrace) {
  return [...pending.values()]
    .filter((p) => p.request.windowId === windowId && (!trace || p.request.trace.id === trace.id))
    .map((p) => ({ id: p.request.id, source: p.request.source, topic: p.request.topic }));
}
function finish(id: string, data: MessageData, error?: string) {
  const item = pending.get(id);
  if (!item) return;
  const interrupted = !item.canCommit();
  if (interrupted) {
    data = null;
    error = "communication.interrupted";
  }
  clearTimeout(item.timer);
  pending.delete(id);
  const result = object(data);
  void recordStep(
    "message.replied",
    {
      requestId: id,
      topic: item.request.topic,
      from: item.request.windowId || "system",
      to: item.sender,
      path: typeof result.path === "string" ? result.path : undefined,
      version: typeof result.version === "string" ? result.version : undefined,
      error,
    },
    messageContext.getStore()?.id === item.request.trace.id
      ? messageContext.getStore()
      : item.request.trace,
    error ? "error" : "info",
  ).catch((e) => console.warn("[activity] reply log failed", e));
  bus.emit("app.delivery.cancel", { id, windowId: item.request.windowId, abort: !!error });
  // A cancelled parent must also stop read/write continuations and child requests.
  for (const [childId, child] of pending)
    if (child.request.trace.requests?.includes(id))
      finish(childId, null, error ?? "communication.interrupted");
  const sender = getWindow(item.sender);
  if (!sender?.isOpen) return;
  const native = getApp(sender.appId)?.presetId;
  deliver({
    id: ulid(),
    windowId: item.sender,
    source: item.request.windowId ? sourceOrSystem(item.request.windowId) : { system: true },
    kind: "response",
    correlationId: id,
    topic: item.request.topic,
    data,
    error,
    mode:
      interrupted || (native && NATIVE_PRESET_APPS.includes(native)) ? "data" : item.responseMode,
    channel: item.channel,
    expiresAt: Date.now() + MESSAGE_TIMEOUT,
    trace: {
      ...item.request.trace,
      requests: item.request.trace.requests?.filter((requestId) => requestId !== id),
    },
  });
}
function sourceOrSystem(windowId: string): MessageSource {
  const window = getWindow(windowId);
  return window ? { appId: window.appId, windowId } : { system: true };
}

async function resolveTarget(
  target: Exclude<MessageTarget, { system: string }>,
  mode: "data" | "ai",
  openerWindowId?: string,
): Promise<string> {
  if ("windowId" in target) {
    sourceFor(target.windowId);
    return target.windowId;
  }
  const app = getApp(target.appId);
  if (!app) throw new Error("communication.missingApp");
  const launching = opening.get(app.id);
  if (launching && (!target.newWindow || app.manifest.singleInstance)) return launching;
  const existing = listOpenWindows()
    .filter((w) => w.appId === app.id)
    .sort((a, b) => b.z - a.z)[0];
  if (existing && (!target.newWindow || app.manifest.singleInstance)) return existing.id;
  if (!target.open && !target.newWindow) throw new Error("communication.unavailable");
  if (
    mode === "data" &&
    !(app.presetId && NATIVE_PRESET_APPS.includes(app.presetId)) &&
    !app.manifest.seedHtml?.trim()
  )
    throw new Error("communication.notReady");
  const launch = async () => {
    const window = await openWindow({
      appId: app.id,
      openerWindowId,
      title: app.name,
      kind: app.presetId ? "system" : "app",
      size: app.manifest.defaultSize,
    });
    await ensureMemory(window.id, app.id);
    broadcast("s2c.window.opened", { window });
    // Seeded apps retain their executable-free declarations. Otherwise the message
    // itself supplies first-paint context, avoiding a redundant first generation.
    if (app.manifest.seedHtml?.trim()) await renderInitialWindow(window.id, app);
    return window.id;
  };
  if (target.newWindow && !app.manifest.singleInstance) return launch();
  let job = opening.get(app.id);
  if (!job) {
    job = launch().finally(() => {
      if (opening.get(app.id) === job) opening.delete(app.id);
    });
    opening.set(app.id, job);
  }
  return job;
}

async function systemCall(
  system: string,
  topic: string,
  data: MessageData,
  beforeWrite = () => {},
  appId?: string,
): Promise<MessageData> {
  const args = object(data);
  if (system === "app-data") {
    if (!appId) throw new Error("communication.invalid");
    const snapshot =
      topic === "get"
        ? getAppData(appId)
        : topic === "set"
          ? await setAppData(appId, data, beforeWrite)
          : null;
    if (!snapshot) throw new Error("communication.unsupported");
    await recordStep(topic === "get" ? "appData.read" : "appData.write", {
      appId,
      version: snapshot.version,
      previousVersion: typeof args.version === "string" ? args.version : undefined,
    });
    if (topic === "set" && snapshot.version !== args.version)
      broadcast("s2c.appData.changed", snapshot);
    return JSON.parse(JSON.stringify(snapshot));
  }
  if (system === "files") {
    const parsed = diskCommandSchema.safeParse({ ...args, action: topic });
    if (!parsed.success) throw new Error("communication.invalid");
    // App workflows may trash files; permanent deletion stays in the native Trash UI.
    if (parsed.data.action === "delete") throw new Error("communication.unsupported");
    return JSON.parse(JSON.stringify(await executeFileCommand(parsed.data, beforeWrite)));
  }
  if (system === "apps") {
    if (topic === "list")
      return listApps().map((a) => ({
        id: a.id,
        name: a.name,
        installed: a.isInstalled,
        fileTypes: a.manifest.fileTypes ?? [],
        operations: a.manifest.operations ?? [],
        native: !!a.presetId && NATIVE_PRESET_APPS.includes(a.presetId),
      }));
    if (topic === "windows")
      return listOpenWindows().map((w) => ({
        id: w.id,
        appId: w.appId,
        title: w.title,
        state: w.state,
        focused: w.focused,
      }));
  }
  if (system === "settings") {
    if (topic === "set") {
      const result = z
        .object({
          theme: z.enum(["light", "dark"]).optional(),
          locale: z.enum(["zh", "en"]).optional(),
          skin: skinIdSchema.transform((s) => s as Skin).optional(),
        })
        .strict()
        .safeParse(args);
      if (!result.success) throw new Error("communication.invalid");
      if (result.data.skin) getSkin(result.data.skin);
      await updateSettings(() => {
        beforeWrite();
        return result.data;
      });
      broadcast("s2c.settings.changed", { settings: loadSettings() });
    } else if (topic !== "get") throw new Error("communication.unsupported");
    const settings = loadSettings();
    return {
      theme: settings.theme,
      locale: settings.locale ?? null,
      skin: settings.skin ?? "devdock",
    };
  }
  throw new Error("communication.unsupported");
}

async function nativeCall(
  windowId: string,
  topic: string,
  data: MessageData,
  beforeWrite = () => {},
): Promise<MessageData> {
  const window = getWindow(windowId)!;
  const preset = getApp(window.appId)?.presetId;
  const args = object(data);
  if (
    ["text-viewer", "media-viewer", "file-manager"].includes(preset ?? "") &&
    topic === "file.open"
  ) {
    if (typeof args.path !== "string") throw new Error("communication.invalid");
    const stat = await executeFileCommand({ action: "stat", path: args.path }, beforeWrite);
    beforeWrite();
    if (stat.entry?.kind === "symlink" || !stat.entry) throw new Error("communication.invalid");
    if (preset === "file-manager") {
      const path =
        stat.entry.kind === "directory" ? args.path : args.path.split("/").slice(0, -1).join("/");
      broadcast("s2c.chrome.set", { windowId, patch: { path, file: "" } });
    } else {
      if (stat.entry.kind === "directory") throw new Error("files.error.notFile");
      if (window.filePath && window.filePath !== args.path) throw new Error("communication.busy");
      const updated = await setWindowFile(windowId, args.path, basename(args.path));
      if (updated) broadcast("s2c.window.stateChanged", { window: updated });
    }
    await focusWindow(windowId);
    broadcast("s2c.window.focused", { windowId });
    return { windowId, path: args.path };
  }
  if (preset === "skins" && topic === "skin.activate") {
    if (
      typeof args.id !== "string" ||
      (args.versionId !== undefined && typeof args.versionId !== "string")
    )
      throw new Error("communication.invalid");
    await handleSkinCommand({
      action: "activate",
      id: args.id,
      versionId: args.versionId as string | undefined,
    });
    return { skin: args.id };
  }
  if (preset === "settings") return systemCall("settings", topic, data, beforeWrite);
  throw new Error("communication.unsupported");
}

/** Identity and causal trace are supplied by the runtime, never by app payloads. */
export async function communicate(
  windowId: string,
  input: CommunicationCommand,
  requestId = ulid(),
  trace = messageContext.getStore(),
  canCommit = () => true,
): Promise<{ error: string } | undefined> {
  if (!canCommit()) throw new Error("communication.interrupted");
  const source = sourceFor(windowId);
  if (trace?.requests?.some((id) => !requestAlive(id)))
    throw new Error("communication.interrupted");
  const command = communicationCommandSchema.parse(input);
  if (command.action === "refresh") {
    refreshAppData(windowId);
    await Promise.all(
      listSubscriptions()
        .filter((s) => s.windowId === windowId && s.subscription.refresh)
        .map((s) =>
          eventDelivery(windowId, s.subscription, s.subscription.topic, null, { system: true }),
        ),
    );
    return;
  }
  if (command.action === "subscribe") {
    await setSubscription(windowId, command.subscription);
    if (command.subscription.refresh)
      await eventDelivery(windowId, command.subscription, command.subscription.topic, null, {
        system: true,
      });
    return;
  }
  if (command.action === "unsubscribe") {
    await removeSubscription(windowId, command.id);
    bus.emit("app.delivery.cancel", { windowId, subscriptionId: command.id, abort: true });
    return;
  }
  if (command.action === "reply") {
    const item = pending.get(command.messageId);
    if (!item || item.request.windowId !== windowId) throw new Error("communication.invalidReply");
    finish(command.messageId, command.data ?? null, command.error);
    return;
  }
  if (command.action === "publish") {
    publish(command.topic, command.data ?? null, source, nextTrace(trace, source));
    return;
  }
  if (pending.has(requestId)) throw new Error("communication.duplicate");
  if (
    pending.size >= 256 ||
    [...pending.values()].filter((p) => p.sender === windowId).length >= 16
  )
    throw new Error("communication.limit");
  let targetWindow = "";
  const expiresAt = Date.now() + (command.timeoutMs ?? MESSAGE_TIMEOUT);
  const request: AppDelivery = {
    id: requestId,
    windowId: "",
    source,
    kind: command.action === "request" ? "request" : "message",
    topic: command.topic,
    data: command.data ?? null,
    mode: command.mode,
    channel: command.channel,
    expiresAt,
    trace: trace ?? { id: requestId, hops: 0, windows: [windowId] },
  };
  if (command.action === "request") {
    const timer = setTimeout(
      () => finish(requestId, null, "communication.timeout"),
      expiresAt - Date.now(),
    );
    timer.unref?.();
    pending.set(requestId, {
      canCommit,
      request,
      sender: windowId,
      responseMode: command.responseMode,
      channel: command.channel,
      timer,
    });
  }
  try {
    if (!("system" in command.target))
      targetWindow = await resolveTarget(command.target, command.mode, windowId);
    sourceFor(windowId);
    request.windowId = targetWindow;
    request.trace = nextTrace(request.trace, source, targetWindow || undefined);
    if (command.action === "request")
      request.trace.requests = [...(request.trace.requests ?? []), requestId];
    if (Date.now() >= expiresAt || (command.action === "request" && !pending.has(requestId)))
      return;
    await recordStep(
      command.action === "request" ? "message.requested" : "message.sent",
      {
        requestId,
        from: windowId,
        to: "system" in command.target ? command.target.system : targetWindow,
        topic: command.topic,
        mode: command.mode,
      },
      request.trace,
    );
    const preset = targetWindow ? getApp(getWindow(targetWindow)!.appId)?.presetId : undefined;
    if ("system" in command.target || (preset && NATIVE_PRESET_APPS.includes(preset))) {
      const beforeWrite = () => {
        if (!canCommit() || !deliveryAlive(request) || !getWindow(windowId)?.isOpen)
          throw new Error("communication.interrupted");
      };
      const result = await messageContext.run(request.trace, () =>
        "system" in command.target
          ? systemCall(
              command.target.system,
              command.topic,
              request.data,
              beforeWrite,
              source.appId,
            )
          : nativeCall(targetWindow, command.topic, request.data, beforeWrite),
      );
      const resultSize = new TextEncoder().encode(JSON.stringify(result)).length;
      if (resultSize > MESSAGE_BYTES) throw new Error("communication.tooLarge");
      const safe = messageDataSchema.parse(result);
      if (command.action === "request") finish(requestId, safe);
    } else {
      if (command.mode === "data" && !getMemory(targetWindow)?.htmlSnapshot.trim())
        throw new Error("communication.notReady");
      deliver(request);
    }
  } catch (error) {
    if (command.action === "request") {
      const code = communicationError(error);
      finish(requestId, null, code);
      return { error: code };
    } else throw error;
  }
}

function matchesPath(filter: string | undefined, data: MessageData): boolean {
  if (filter === undefined) return true;
  const args = object(data);
  const paths = Array.isArray(args.paths)
    ? args.paths
    : typeof args.path === "string"
      ? [args.path]
      : [];
  const base = filter.replace(/^\/+|\/+$/g, "");
  return paths.some(
    (p) =>
      typeof p === "string" &&
      (!base || p === base || p.startsWith(base + "/") || base.startsWith(p + "/")),
  );
}
function publish(topic: string, data: MessageData, source: MessageSource, trace?: MessageTrace) {
  for (const { windowId, subscription: sub } of listSubscriptions()) {
    if (sub.topic !== topic || !matchesPath(sub.path, data)) continue;
    if (
      "system" in sub.source
        ? !("system" in source)
        : !("appId" in source) ||
          (sub.source.appId === "self" ? getWindow(windowId)?.appId : sub.source.appId) !==
            source.appId
    )
      continue;
    // Do not feed a workflow's own mutations back into that workflow.
    if (sub.mode === "ai" && trace?.windows.includes(windowId)) continue;
    if (
      !("system" in source) ||
      !["files.changed", "settings.changed", "apps.changed"].includes(topic)
    ) {
      void eventDelivery(windowId, sub, topic, data, source, trace).catch(() => {});
      continue;
    }
    const key = windowId + ":" + sub.id;
    const previous = eventTimers.get(key);
    clearTimeout(previous?.timer);
    let batchData = data;
    let batchTrace = trace;
    if (topic === "files.changed" && previous) {
      const paths = [
        ...((object(previous.data).paths as string[]) ?? []),
        ...((object(data).paths as string[]) ?? []),
      ];
      batchData = { paths: [...new Set(paths)] };
      if (previous.trace)
        batchTrace = {
          ...(trace ?? previous.trace),
          windows: [...new Set([...previous.trace.windows, ...(trace?.windows ?? [])])],
          hops: Math.max(previous.trace.hops, trace?.hops ?? 0),
        };
    }
    const timer = setTimeout(() => {
      eventTimers.delete(key);
      void eventDelivery(windowId, sub, topic, batchData, source, batchTrace).catch(() => {});
    }, 60);
    timer.unref?.();
    eventTimers.set(key, { timer, data: batchData, trace: batchTrace });
  }
}
async function eventDelivery(
  windowId: string,
  sub: AppSubscription | undefined,
  topic: string,
  data: MessageData,
  source: MessageSource,
  trace?: MessageTrace,
) {
  if (
    !getWindow(windowId)?.isOpen ||
    (sub &&
      !listSubscriptions().some(
        (s) =>
          s.windowId === windowId &&
          s.subscription.id === sub.id &&
          JSON.stringify(s.subscription) === JSON.stringify(sub),
      ))
  )
    return;
  let error: string | undefined;
  if (sub?.refresh) {
    try {
      data = messageDataSchema.parse(await executeFileCommand(sub.refresh));
    } catch (e) {
      data = null;
      error = communicationError(e);
    }
  }
  deliver({
    id: ulid(),
    windowId,
    source,
    kind: "event",
    subscriptionId: sub?.id,
    topic,
    data,
    error,
    channel: sub?.channel ?? sub?.id,
    mode: sub?.mode ?? "ai",
    expiresAt: Date.now() + MESSAGE_TIMEOUT,
    trace:
      sub?.mode !== "data"
        ? nextTrace(trace ? { ...trace, requests: [] } : undefined, source, windowId)
        : (trace ?? { id: ulid(), hops: 0, windows: [] }),
  });
}
function refreshAppData(windowId: string) {
  const window = getWindow(windowId);
  if (!window?.isOpen) return;
  const data = JSON.parse(JSON.stringify(getAppData(window.appId)));
  deliver({
    id: ulid(),
    windowId,
    source: { system: true },
    kind: "event",
    topic: "app.data.changed",
    data,
    mode: "data",
    channel: "appData",
    expiresAt: Date.now() + MESSAGE_TIMEOUT,
    trace: { id: ulid(), hops: 0, windows: [] },
  });
}
function observe(message: ServerToClient, trace?: MessageTrace) {
  const source: MessageSource = { system: true };
  switch (message.type) {
    case "s2c.appData.changed": {
      const appId = message.payload.appId;
      const app = getApp(appId);
      const subscriptions = listSubscriptions();
      // A persisted state refresh is not a request continuation. The upstream
      // sender also needs the result; only the actual writer is already rendering it.
      const refreshTrace = trace
        ? { ...trace, windows: trace.windows.slice(-1), requests: [] }
        : undefined;
      for (const window of listOpenWindows()) {
        if (window.appId !== appId) continue;
        refreshAppData(window.id);
        // Shared application state is a runtime relationship. Legacy generated views
        // participate without needing to have invented their own subscriptions.
        if (
          refreshTrace?.windows.includes(window.id) ||
          (app?.presetId && NATIVE_PRESET_APPS.includes(app.presetId)) ||
          !getMemory(window.id)?.htmlSnapshot.trim()
        )
          continue;
        const declared = subscriptions.some(
          ({ windowId, subscription: sub }) =>
            windowId === window.id &&
            sub.topic === "app.data.changed" &&
            "appId" in sub.source &&
            ["self", appId].includes(sub.source.appId),
        );
        if (!declared)
          void eventDelivery(
            window.id,
            undefined,
            "app.data.changed",
            JSON.parse(JSON.stringify(message.payload)),
            { appId, windowId: refreshTrace?.windows[0] ?? "system" },
            refreshTrace,
          ).catch((error) => console.warn("[communication] app state refresh failed", error));
      }
      publish(
        "app.data.changed",
        JSON.parse(JSON.stringify(message.payload)),
        { appId, windowId: refreshTrace?.windows[0] ?? "system" },
        refreshTrace,
      );
      break;
    }
    case "s2c.apps.changed":
      publish("apps.changed", {}, source, trace);
      break;
    case "s2c.files.changed":
      if (message.payload.paths?.length)
        publish("files.changed", { paths: message.payload.paths }, source, trace);
      break;
    case "s2c.settings.changed": {
      const s = message.payload.settings;
      publish(
        "settings.changed",
        { theme: s.theme, skin: s.skin ?? "devdock", locale: s.locale ?? null },
        source,
        trace,
      );
      break;
    }
    case "s2c.syscall.appInstalled":
      publish("apps.changed", { appId: message.payload.app.id }, source, trace);
      break;
    case "s2c.window.opened":
      publish(
        "windows.opened",
        { windowId: message.payload.window.id, appId: message.payload.window.appId },
        source,
        trace,
      );
      break;
    case "s2c.window.closed":
      closeCommunicationWindow(message.payload.windowId);
      publish("windows.closed", { windowId: message.payload.windowId }, source, trace);
      break;
  }
}
export function closeCommunicationWindow(windowId: string) {
  void removeSubscription(windowId);
  for (const [key, item] of eventTimers)
    if (key.startsWith(windowId + ":")) {
      clearTimeout(item.timer);
      eventTimers.delete(key);
    }
  for (const [id, item] of pending) {
    if (item.sender === windowId || item.request.windowId === windowId)
      finish(id, null, "communication.closed");
  }
}
export async function registerCommunication() {
  if (registered) return;
  await recoverSubscriptions();
  registered = true;
  bus.on("disk.changed", ({ paths, trace }) => {
    const refresh = () => {
      void broadcastDiskChanges(paths).catch((error) =>
        console.warn("[files] refresh failed", error),
      );
    };
    if (trace) messageContext.run(trace, refresh);
    else messageContext.exit(refresh);
  });
  bus.on("system.broadcast", ({ message, trace }) => observe(message, trace));
}
