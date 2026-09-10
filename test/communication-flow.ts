// Run in a child process so the suite's offline provider and this local HTTP
// provider cannot affect each other. No external model or user data is used.
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import type { AppDelivery } from "@vibeos/shared";
import { migrate } from "../apps/backend/src/db/migrate.ts";
import { getDb } from "../apps/backend/src/db/database.ts";
import { installApp } from "../apps/backend/src/db/repositories/AppRepo.ts";
import { openWindow, closeWindow } from "../apps/backend/src/db/repositories/WindowRepo.ts";
import {
  ensureMemory,
  saveSnapshot,
  getMemory,
} from "../apps/backend/src/db/repositories/AppMemoryRepo.ts";
import {
  ensureSettings,
  updateSettings,
  loadSettings,
} from "../apps/backend/src/db/repositories/SettingsRepo.ts";
import { ModelPolicy } from "../apps/backend/src/ai/ModelPolicy.ts";
import {
  communicate,
  registerCommunication,
  closeCommunicationWindow,
} from "../apps/backend/src/events/communication.ts";
import { registerUiGenerationAgent } from "../apps/backend/src/agents/UiGenerationAgent.ts";
import { bus } from "../apps/backend/src/events/bus.ts";
import { executeDisk, diskPath } from "../apps/backend/src/files/disk.ts";

const messages: AppDelivery[] = [];
const seen: string[] = [];
const patches: string[] = [];
const busy = new Map<string, boolean>();
let continuationDelay = 0;
const calls = (command: object) =>
  "\n\n```vibeos-syscall\n" +
  JSON.stringify({ calls: [{ type: "communication", command }] }) +
  "\n```";
const region = (text: string) =>
  '<vibeos-html mode="regions"><section data-vibeos-region="result">' +
  text +
  "</section></vibeos-html>";
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const body = (await req.json()) as { messages: { content: string }[] };
    const prompt = body.messages.at(-1)!.content;
    const raw = prompt.match(/\[APP MESSAGE\]\n([^\n]+)/)?.[1];
    const message: AppDelivery | undefined = raw ? JSON.parse(raw) : undefined;
    let output = region("user action"),
      delay = 0;
    if (message) {
      seen.push(message.id);
      const data = message.data as Record<string, string | number>;
      if (message.kind === "request" && message.topic === "file.open") {
        output = calls({
          action: "request",
          target: { system: "files" },
          topic: "read",
          data: { path: data.path },
          responseMode: "ai",
        });
      } else if (message.kind === "response" && message.topic === "read") {
        assert.equal(message.error, undefined);
        delay = continuationDelay;
        output = calls({
          action: "request",
          target: { system: "files" },
          topic: "write",
          data: {
            path: String(data.path) + ".result",
            content: String(data.content).toUpperCase(),
          },
          responseMode: "ai",
        });
      } else if (message.kind === "response" && message.topic === "write") {
        assert.equal(message.error, undefined);
        output =
          region("saved " + data.path) +
          calls({
            action: "reply",
            messageId: message.trace.requests![0],
            data: { path: data.path },
          });
      } else if (message.kind === "request" && message.topic === "slow") {
        delay = 1500;
        output =
          region("stale") +
          calls({
            action: "request",
            target: { system: "files" },
            topic: "write",
            data: { path: "Documents/should-not-exist.txt", content: "stale" },
            responseMode: "data",
          });
      } else if (message.kind === "event") {
        delay = 250;
        output = region("unsubscribed stale event");
      } else if (message.kind === "request") {
        delay = 50;
        output =
          region(String(data.n)) +
          calls({ action: "reply", messageId: message.id, data: { n: data.n } });
      }
    }
    return new Response(
      new ReadableStream({
        async start(controller) {
          if (delay) await Bun.sleep(delay);
          controller.enqueue(
            new TextEncoder().encode(
              "data: " +
                JSON.stringify({
                  choices: [{ index: 0, delta: { content: output }, finish_reason: "stop" }],
                }) +
                "\n\ndata: [DONE]\n\n",
            ),
          );
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  },
});

async function until(predicate: () => unknown, label: string, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(5);
  assert(predicate(), label);
}
try {
  migrate(getDb());
  await ensureSettings();
  await updateSettings({
    apiProviders: { kimi: { apiKey: "local-test", baseUrl: server.url + "v1" } },
    modelOverrides: { "ui-generation": { provider: "kimi", model: "local-test" } },
  });
  ModelPolicy.recompute(loadSettings().modelOverrides);
  await registerCommunication();
  mkdirSync(diskPath("Documents"), { recursive: true });
  registerUiGenerationAgent();
  const app = await installApp({ name: "Processor" });
  const source = await openWindow({ appId: app.id, title: "Sender" });
  const target = await openWindow({ appId: app.id, title: "Receiver" });
  await ensureMemory(target.id, app.id);
  await saveSnapshot(
    target.id,
    '<main data-vibeos-region="root"><input name="draft" value="keep me"><section data-vibeos-region="result">ready</section></main>',
  );
  bus.on("system.broadcast", ({ message }) => {
    if (message.type === "s2c.communication.delivery") messages.push(message.payload.delivery);
    if (message.type === "s2c.ui.patch" && message.payload.done) patches.push(message.payload.mode);
    if (message.type === "s2c.ui.busy") busy.set(message.payload.windowId, message.payload.busy);
  });
  const response = (id: string) => messages.find((m) => m.correlationId === id);
  for (const n of [1, 2, 3])
    await communicate(
      source.id,
      {
        action: "request",
        target: { windowId: target.id },
        topic: "ping",
        data: { n },
      },
      "ping" + n,
    );
  await until(() => response("ping3"), "all queued requests reply");
  assert.deepEqual(seen.slice(0, 3), ["ping1", "ping2", "ping3"]);
  for (const n of [1, 2, 3]) assert.deepEqual(response("ping" + n)?.data, { n });
  assert.equal(getMemory(target.id)?.htmlSnapshot.includes('value="keep me"'), true);
  assert(patches.every((mode) => mode === "regions"));

  executeDisk({ action: "write", path: "Documents/input.txt", content: "Actual disk content" });
  await communicate(
    source.id,
    {
      action: "request",
      target: { windowId: target.id },
      topic: "file.open",
      data: { path: "Documents/input.txt" },
    },
    "file",
  );
  await until(() => response("file"), "file workflow completes");
  assert.equal(response("file")?.error, undefined);
  assert.equal(
    executeDisk({ action: "read", path: "Documents/input.txt.result" }).content,
    "ACTUAL DISK CONTENT",
  );
  assert.equal(getMemory(target.id)?.htmlSnapshot.includes('value="keep me"'), true);

  await communicate(
    source.id,
    { action: "request", target: { windowId: target.id }, topic: "slow" },
    "preempt",
  );
  await until(() => seen.includes("preempt"), "slow request started");
  bus.emit("op.received", { windowId: target.id, op: { kind: "click", action: "manual" } });
  await until(() => getMemory(target.id)?.htmlSnapshot.includes("user action"), "user op wins");
  assert.equal(response("preempt")?.error, "communication.interrupted");
  await communicate(
    source.id,
    { action: "request", target: { windowId: target.id }, topic: "slow", timeoutMs: 1000 },
    "timeout",
  );
  await until(() => response("timeout"), "timeout replies");
  await until(() => busy.get(target.id) === false, "timeout clears busy");
  await Bun.sleep(550);
  assert.equal(response("timeout")?.error, "communication.timeout");
  assert.equal(existsSync(diskPath("Documents/should-not-exist.txt")), false);
  assert.equal(getMemory(target.id)?.htmlSnapshot.includes("stale"), false);

  await communicate(target.id, {
    action: "subscribe",
    subscription: {
      id: "cancel-event",
      topic: "cancel.event",
      source: { appId: app.id },
      mode: "ai",
    },
  });
  await communicate(source.id, { action: "publish", topic: "cancel.event", data: "event" });
  await until(
    () => messages.some((m) => m.topic === "cancel.event" && seen.includes(m.id)),
    "event generation started",
  );
  await communicate(target.id, { action: "unsubscribe", id: "cancel-event" });
  await Bun.sleep(300);
  assert.equal(getMemory(target.id)?.htmlSnapshot.includes("unsubscribed stale event"), false);
  assert.equal(busy.get(target.id), false);

  continuationDelay = 250;
  executeDisk({ action: "write", path: "Documents/cancel.txt", content: "must not write" });
  await communicate(
    source.id,
    {
      action: "request",
      target: { windowId: target.id },
      topic: "file.open",
      data: { path: "Documents/cancel.txt" },
    },
    "parent",
  );
  await until(
    () =>
      messages.some(
        (m) =>
          m.kind === "response" &&
          m.topic === "read" &&
          (m.data as { path?: string })?.path === "Documents/cancel.txt" &&
          seen.includes(m.id),
      ),
    "read continuation started",
  );
  await closeWindow(source.id);
  closeCommunicationWindow(source.id);
  await Bun.sleep(350);
  assert.equal(existsSync(diskPath("Documents/cancel.txt.result")), false);
  assert.equal(busy.get(target.id), false);
  console.log("communication pipeline passed");
} finally {
  server.stop(true);
}
