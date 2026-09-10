import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  communicationCommandSchema,
  messageDataSchema,
  MESSAGE_BYTES,
  type AppDelivery,
} from "@vibeos/shared";
import { getDb } from "../db/database.ts";
import { migrate } from "../db/migrate.ts";
import { installApp, seedPresets, listApps } from "../db/repositories/AppRepo.ts";
import { openWindow, closeWindow, getWindow } from "../db/repositories/WindowRepo.ts";
import { ensureMemory, saveSnapshot } from "../db/repositories/AppMemoryRepo.ts";
import { listSubscriptions, parseSubscriptions } from "../db/repositories/CommunicationRepo.ts";
import { ensureSettings } from "../db/repositories/SettingsRepo.ts";
import { enqueue } from "../db/repositories/writeQueue.ts";
import { executeDisk, diskPath } from "../files/disk.ts";
import { bus } from "./bus.ts";
import {
  communicate,
  registerCommunication,
  closeCommunicationWindow,
  deliveryAlive,
} from "./communication.ts";

async function setup() {
  migrate(getDb());
  await ensureSettings();
  await seedPresets();
  await registerCommunication();
  mkdirSync(diskPath("Documents"), { recursive: true });
  const app = await installApp({ name: "Communication check" });
  const first = await openWindow({ appId: app.id, title: app.name });
  const second = await openWindow({ appId: app.id, title: app.name });
  await ensureMemory(first.id, app.id);
  await ensureMemory(second.id, app.id);
  const messages: AppDelivery[] = [];
  const off = bus.on("system.broadcast", ({ message }) => {
    if (message.type === "s2c.communication.delivery") messages.push(message.payload.delivery);
  });
  const response = (id: string) => messages.find((m) => m.correlationId === id)!;
  return {
    first,
    second,
    app,
    messages,
    response,
    async close() {
      off();
      for (const window of [first, second]) {
        await closeWindow(window.id);
        closeCommunicationWindow(window.id);
      }
    },
  };
}

test("communication validates data and declarations before accepting a snapshot", async () => {
  for (const data of [
    new Array(18).fill(0).reduce((a) => [a], 0),
    "x".repeat(MESSAGE_BYTES + 1),
    JSON.parse('{"__proto__":{"x":1}}'),
    Number.NaN,
  ])
    expect(messageDataSchema.safeParse(data).success).toBe(false);
  expect(
    communicationCommandSchema.safeParse({
      action: "send",
      target: { windowId: "x", appId: "y" },
      topic: "test",
    }).success,
  ).toBe(false);
  const subscription = {
    id: "files",
    topic: "files.changed",
    source: { system: true },
    path: "Documents",
    mode: "data",
  } as const;
  const html = `<main data-vibeos-subscriptions='${JSON.stringify([subscription])}'></main>`;
  expect(await parseSubscriptions(html)).toEqual([subscription]);
  await expect(parseSubscriptions(html + html)).rejects.toThrow();
  const s = await setup();
  try {
    await saveSnapshot(s.first.id, html);
    expect(listSubscriptions().find((x) => x.windowId === s.first.id)?.subscription).toEqual(
      subscription,
    );
    await expect(saveSnapshot(s.first.id, html + html)).rejects.toThrow();
    expect(listSubscriptions().filter((x) => x.windowId === s.first.id)).toHaveLength(1);
  } finally {
    await s.close();
  }
});

test("directed requests enforce reply ownership, preserve custom events and stop causal loops", async () => {
  const s = await setup();
  const received: AppDelivery[] = [];
  const off = bus.on("app.delivery", ({ delivery }) => received.push(delivery));
  try {
    await communicate(
      s.first.id,
      { action: "request", target: { windowId: s.second.id }, topic: "process", data: { n: 1 } },
      "roundtrip",
    );
    const request = received.at(-1)!;
    expect(request.source).toEqual({ appId: s.app.id, windowId: s.first.id });
    await expect(
      communicate(s.first.id, { action: "reply", messageId: "roundtrip", data: "spoof" }),
    ).rejects.toThrow("invalidReply");
    await communicate(
      s.second.id,
      { action: "request", target: { windowId: s.first.id }, topic: "cycle" },
      "cycle",
      request.trace,
    );
    expect(s.response("cycle").error).toBe("communication.loop");
    await communicate(s.second.id, {
      action: "reply",
      messageId: "roundtrip",
      data: { result: 2 },
    });
    expect(s.response("roundtrip").data).toEqual({ result: 2 });
    expect(deliveryAlive(request)).toBe(false);
    const before = received.length;
    await saveSnapshot(s.second.id, '<p data-vibeos-bind="selection">Ready</p>');
    await communicate(s.first.id, {
      action: "send",
      target: { windowId: s.second.id },
      topic: "selection",
      mode: "data",
      channel: "selection",
      data: 3,
    });
    expect(received.length).toBe(before);
    expect(s.messages.at(-1)?.data).toBe(3);
    await communicate(s.second.id, {
      action: "subscribe",
      subscription: {
        id: "records",
        topic: "record.changed",
        source: { appId: s.app.id },
        mode: "data",
      },
    });
    for (const n of [1, 2, 3])
      await communicate(s.first.id, { action: "publish", topic: "record.changed", data: n });
    expect(s.messages.filter((m) => m.kind === "event").map((m) => m.data)).toEqual([1, 2, 3]);
    await communicate(s.second.id, { action: "unsubscribe", id: "records" });
    await communicate(s.first.id, { action: "publish", topic: "record.changed", data: 4 });
    expect(s.messages.filter((m) => m.kind === "event")).toHaveLength(3);
  } finally {
    off();
    await s.close();
  }
});

test("system file requests use real bytes, conflict guards, filtered refresh and native viewers", async () => {
  const s = await setup();
  const path = `Documents/communication-${randomUUID()}.txt`;
  executeDisk({ action: "write", path, content: "original" });
  try {
    await communicate(s.second.id, {
      action: "subscribe",
      subscription: {
        id: "file",
        topic: "files.changed",
        source: { system: true },
        mode: "data",
        path,
        refresh: { action: "read", path },
      },
    });
    expect(s.messages.at(-1)?.data).toMatchObject({ content: "original" });
    await communicate(s.second.id, {
      action: "subscribe",
      subscription: {
        id: "file-ai",
        topic: "files.changed",
        source: { system: true },
        mode: "ai",
        path,
      },
    });
    await communicate(
      s.first.id,
      { action: "request", target: { system: "files" }, topic: "read", data: { path } },
      "read",
    );
    const read = s.response("read").data as { version: string };
    await communicate(
      s.first.id,
      {
        action: "request",
        target: { system: "files" },
        topic: "write",
        data: { path, content: "updated", version: read.version },
      },
      "write",
    );
    expect(s.response("write").error).toBeUndefined();
    await Bun.sleep(90);
    expect(
      s.messages.filter((m) => m.kind === "event" && m.channel === "file").at(-1)?.data,
    ).toMatchObject({
      content: "updated",
    });
    const event = s.messages.find((m) => m.channel === "file-ai")!;
    expect(deliveryAlive(event)).toBe(true);
    expect(event.trace.requests).toEqual([]);
    await communicate(
      s.first.id,
      {
        action: "request",
        target: { system: "files" },
        topic: "write",
        data: { path, content: "stale", version: read.version },
      },
      "stale",
    );
    expect(s.response("stale").error).toBe("files.error.conflict");
    expect(executeDisk({ action: "read", path }).content).toBe("updated");
    await communicate(
      s.first.id,
      {
        action: "request",
        target: { system: "files" },
        topic: "read",
        data: { path: "../runtime/vibeos.db" },
      },
      "escape",
    );
    expect(s.response("escape").error).toBeTruthy();
    await communicate(
      s.first.id,
      { action: "request", target: { system: "settings" }, topic: "get" },
      "settings",
    );
    expect(Object.keys(s.response("settings").data!)).toEqual(["theme", "locale", "skin"]);
    const viewer = listApps().find((a) => a.presetId === "text-viewer")!;
    await communicate(
      s.first.id,
      {
        action: "request",
        target: { appId: viewer.id, newWindow: true },
        topic: "file.open",
        data: { path },
      },
      "viewer",
    );
    const id = (s.response("viewer").data as { windowId: string }).windowId;
    expect(getWindow(id)?.filePath).toBe(path);
    await closeWindow(id);
    closeCommunicationWindow(id);
  } finally {
    rmSync(diskPath(path), { force: true });
    await s.close();
  }
});

test("timeouts and closed windows cancel child work before a queued disk write", async () => {
  const s = await setup();
  const path = `Documents/cancelled-${randomUUID()}.txt`;
  try {
    await communicate(
      s.first.id,
      { action: "request", target: { windowId: s.second.id }, topic: "slow", timeoutMs: 1000 },
      "slow",
    );
    const request = s.messages.find((m) => m.id === "slow")!;
    let release!: () => void;
    const block = enqueue(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Bun.sleep(1);
    const write = communicate(
      s.second.id,
      {
        action: "request",
        target: { system: "files" },
        topic: "write",
        data: { path, content: "too late" },
      },
      "child",
      request.trace,
    );
    await Bun.sleep(1050);
    expect(s.response("slow").error).toBe("communication.timeout");
    release();
    await block;
    await write;
    expect(existsSync(diskPath(path))).toBe(false);
    await communicate(
      s.first.id,
      { action: "request", target: { windowId: s.second.id }, topic: "close" },
      "close",
    );
    await closeWindow(s.second.id);
    closeCommunicationWindow(s.second.id);
    expect(s.response("close").error).toBe("communication.closed");
    expect(listSubscriptions().some((x) => x.windowId === s.second.id)).toBe(false);
  } finally {
    await s.close();
  }
});

test("AI communication pipeline queues messages, continues real file operations and rejects cancelled output", () => {
  const data = join(tmpdir(), `vibeos-communication-pipeline-${randomUUID()}`);
  try {
    const result = Bun.spawnSync([process.execPath, "test/communication-flow.ts"], {
      cwd: new URL("../../../../", import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        VIBEOS_AI_STUB: "0",
        VIBEOS_DATA_DIR: data,
        VIBEOS_DB_PATH: join(data, "runtime/vibeos.db"),
      },
      timeout: 15000,
    });
    expect(result.exitCode, result.stderr.toString() + result.stdout.toString()).toBe(0);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
