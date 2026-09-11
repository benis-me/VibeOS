// Runs against an isolated disk/database via appWorkflow.test.ts. No model/network calls.
import assert from "node:assert/strict";
import { getDb, closeDb } from "../apps/backend/src/db/database.ts";
import { migrate } from "../apps/backend/src/db/migrate.ts";
import { ensureSettings } from "../apps/backend/src/db/repositories/SettingsRepo.ts";
import { ensureDiskLayout } from "../apps/backend/src/files/content.ts";
import { installApp } from "../apps/backend/src/db/repositories/AppRepo.ts";
import {
  openWindow,
  getWindow,
  listOpenWindows,
  closeWindow,
} from "../apps/backend/src/db/repositories/WindowRepo.ts";
import {
  ensureMemory,
  saveSnapshot,
  getMemory,
} from "../apps/backend/src/db/repositories/AppMemoryRepo.ts";
import { getAppData, setAppData } from "../apps/backend/src/db/repositories/ApplicationRepo.ts";
import {
  getProvider,
  setActiveProvider,
  availableProviderIds,
} from "../apps/backend/src/ai/providers/index.ts";
import { registerCommunication, communicate } from "../apps/backend/src/events/communication.ts";
import { registerUiGenerationAgent } from "../apps/backend/src/agents/UiGenerationAgent.ts";
import { bus } from "../apps/backend/src/events/bus.ts";
import * as Agents from "../apps/backend/src/db/repositories/AgentRepo.ts";
import type { ServerToClient } from "@vibeos/shared/protocol";
import type { ProviderRunOptions, RunResult } from "../apps/backend/src/ai/providers/types.ts";

async function until(predicate: () => unknown) {
  for (let n = 0; n < 400 && !predicate(); n++) await Bun.sleep(5);
  assert(predicate(), "workflow completed before timeout");
}
const block = (calls: unknown[]) => "```vibeos-syscall\n" + JSON.stringify({ calls }) + "\n```";
const html = (text: string) =>
  '<vibeos-html mode="full"><main data-vibeos-region="root">' + text + "</main></vibeos-html>";
const section = (prompt: string, name: string) =>
  JSON.parse(prompt.split("[" + name + "]\n")[1]!.split("\n")[0]!);
const kept = { type: "app-state" };
migrate(getDb());
ensureDiskLayout();
await ensureSettings();
const app = await installApp({ name: "Schedule" });
const parent = await openWindow({ appId: app.id, title: "Schedule" });
await ensureMemory(parent.id, app.id);
await saveSnapshot(
  parent.id,
  '<main data-vibeos-region="root"><button data-vibeos-action="view-details" data-id="event-3">UI refactor: pending</button><p>Other task: pending</p></main>',
);
const unrelated = await installApp({ name: "Unrelated" });
for (let n = 0; n < 10; n++) await openWindow({ appId: unrelated.id, title: "Unrelated " + n });
const frames: ServerToClient[] = [];
bus.on("system.broadcast", ({ message }) => frames.push(message));
let childId = "",
  calls = 0,
  refreshes = 0;
let fake: (options: ProviderRunOptions) => Promise<RunResult> = async ({ prompt }) => {
  calls++;
  const current = section(prompt, "WINDOW");
  assert.equal(current.appId, app.id, "unrelated applications never regenerate");
  assert(
    section(prompt, "GLOBAL STATE").openWindows.length >= 11,
    "window IDs never disappear in a busy desktop",
  );
  const state = section(prompt, "SHARED APPLICATION DATA");
  if (prompt.includes("[APP MESSAGE]")) {
    assert.equal(current.windowId, parent.id);
    assert.equal(state.data.tasks["event-3"].done, true);
    if (refreshes === 0) {
      assert(
        prompt.includes('"action":"complete-event"'),
        "peer refresh retains the actual initiating operation",
      );
      assert(prompt.includes("LATEST CANONICAL VALUES"));
      assert(prompt.indexOf("[SHARED APPLICATION DATA]") > prompt.indexOf("[CURRENT UI]"));
      assert(!prompt.includes("[EPISODE MEMORY]"));
      assert(!prompt.includes("[RECENT INTERACTIONS]"));
    }
    refreshes++;
    if (refreshes === 3)
      return { ok: true, text: "<vibeos-summary>The view is already current.</vibeos-summary>" };
    return { ok: true, text: html("UI refactor: completed; other task: pending") };
  }
  if (current.windowId === parent.id) {
    assert.deepEqual(state.data, {});
    return {
      ok: true,
      text: block([
        // State must commit before spawn even when the model orders them backwards.
        {
          type: "spawn-window",
          title: "Task details",
          prompt:
            "Details of task event-3, UI refactor. Completion is optional; keep the details open after completing.",
        },
        {
          type: "app-state",
          data: {
            tasks: {
              "event-3": { name: "UI refactor", done: false },
              "event-4": { name: "Other task", done: false },
            },
          },
        },
      ]),
    };
  }
  childId = current.windowId;
  assert.equal(current.opener.windowId, parent.id);
  assert.equal(
    current.context.data.dataset.id,
    "event-3",
    "spawn retains the initiating record without model-supplied routing IDs",
  );
  assert(current.context.purpose.includes("Details of task event-3"));
  assert(state.data.tasks["event-4"], "legacy records initialize before opening details");
  if (prompt.includes('action="close-details"'))
    return { ok: true, text: block([{ type: "close" }]) };
  if (prompt.includes('action="complete-event"')) {
    state.data.tasks["event-3"].done = true;
    return {
      ok: true,
      text:
        html("Task completed") +
        block([
          { type: "notify", title: "Task completed" },
          { type: "app-state", data: state.data },
        ]),
    };
  }
  return { ok: true, text: html("Task pending; mark complete or close details") + block([kept]) };
};
for (const id of new Set([...availableProviderIds(), "codex"] as const))
  (await getProvider(id)).run = (options) => fake(options);
setActiveProvider("codex");
await registerCommunication();
registerUiGenerationAgent();
bus.emit("op.received", {
  windowId: parent.id,
  op: { kind: "click", action: "view-details", dataset: { id: "event-3" } },
});
await until(() => childId && getMemory(childId)?.htmlSnapshot.includes("Task pending"));
assert.equal(calls, 2, "opening details takes exactly the parent and child render calls");
const version = getAppData(app.id).version;
bus.emit("op.received", {
  windowId: childId,
  op: { id: "complete", kind: "click", action: "complete-event" },
});
await until(() => getMemory(parent.id)?.htmlSnapshot.includes("UI refactor: completed"));
assert.equal(refreshes, 1);
assert.equal(
  calls,
  4,
  "completion and one automatic parent refresh need no extra read/write model turns",
);
assert.notEqual(getAppData(app.id).version, version);
assert(getWindow(childId)?.isOpen, "completing a task never forces window closure");
assert(frames.some((f) => f.type === "s2c.ui.patch" && f.payload.operationId === "complete"));
assert(!Agents.recentRuns(30).some((r) => r.status === "error"));

// Identical writes, including reordered JSON keys, do not wake peer windows.
const current = getAppData(app.id);
const data = current.data as any;
await communicate(childId, {
  action: "request",
  target: { system: "app-data" },
  topic: "set",
  responseMode: "data",
  data: {
    version: current.version,
    data: {
      tasks: { "event-4": data.tasks["event-4"], "event-3": { done: true, name: "UI refactor" } },
    },
  },
});
await Bun.sleep(100);
assert.equal(getAppData(app.id).version, current.version);
assert.equal(refreshes, 1);

// Binding-only peers opt out of model calls, while the upstream request sender
// still refreshes after a downstream window commits its application data.
const bound = await openWindow({ appId: app.id, title: "Bound view" });
await ensureMemory(bound.id, app.id);
await saveSnapshot(
  bound.id,
  '<main data-vibeos-region="root"><span data-vibeos-bind="appData.data.tasks.event-3.done"></span></main>',
);
await communicate(bound.id, {
  action: "subscribe",
  subscription: {
    id: "shared",
    source: { appId: "self" },
    topic: "app.data.changed",
    mode: "data",
  },
});
await communicate(
  childId,
  {
    action: "request",
    target: { system: "app-data" },
    topic: "set",
    responseMode: "data",
    data: { version: current.version, data: { ...data, updated: true } },
  },
  "downstream-write",
  { id: "upstream-workflow", hops: 1, windows: [parent.id, childId] },
);
await until(() => refreshes === 2);
assert.equal(calls, 5, "only the upstream view renders; the explicitly bound view receives data");
assert(
  frames.some(
    (f) =>
      f.type === "s2c.communication.delivery" &&
      f.payload.delivery.windowId === bound.id &&
      f.payload.delivery.mode === "data",
  ),
);
await closeWindow(bound.id);

// Explicit AI subscriptions also refresh upstream; an already-current view can
// acknowledge the event without HTML or another repair/model call.
await communicate(parent.id, {
  action: "subscribe",
  subscription: {
    id: "shared",
    source: { appId: "self" },
    topic: "app.data.changed",
    mode: "ai",
  },
});
const beforeRefresh = frames.length;
await communicate(
  childId,
  {
    action: "request",
    target: { system: "app-data" },
    topic: "set",
    responseMode: "data",
    data: { version: getAppData(app.id).version, data: { ...data, updated: 2 } },
  },
  "explicit-downstream-write",
  { id: "explicit-upstream-workflow", hops: 1, windows: [parent.id, childId] },
);
await until(() =>
  frames
    .slice(beforeRefresh)
    .some((f) => f.type === "s2c.ui.busy" && f.payload.windowId === parent.id && !f.payload.busy),
);
assert.equal(refreshes, 3);
assert.equal(calls, 6, "an already-current view needs no repair");
assert(!frames.slice(beforeRefresh).some((f) => f.type === "s2c.ui.patch"));

bus.emit("op.received", { windowId: childId, op: { kind: "click", action: "close-details" } });
await until(() => !getWindow(childId)?.isOpen);
await Bun.sleep(30);
assert(getWindow(parent.id)?.isOpen);
assert.equal(
  Agents.recentRuns(1)[0]?.status,
  "ok",
  "intentional self-close is a completed operation, not cancellation",
);
closeDb();
assert.equal(getWindow(childId)?.openerWindowId, parent.id);
assert.equal(
  (getAppData(app.id).data as any).tasks["event-3"].done,
  true,
  "completion survives database reopen",
);

// A model cannot publish a success UI with ambiguous/missing state intent, and a
// revision conflict must preserve both the newer data and the prior UI/draft.
const invalidApp = await installApp({ name: "Validation" });
const w = await openWindow({ appId: invalidApp.id, title: "Validation" });
await ensureMemory(w.id, invalidApp.id);
await saveSnapshot(w.id, '<main data-vibeos-region="root">Keep input</main>');
// Another application's event may legitimately update this app's own records.
// Only same-app rendering is read-only; cross-app automations remain functional.
await communicate(w.id, {
  action: "subscribe",
  subscription: {
    id: "other-app",
    source: { appId: app.id },
    topic: "app.data.changed",
    mode: "ai",
  },
});
fake = async () => ({
  ok: true,
  text: html("Keep input") + block([{ type: "app-state", data: { mirrored: true } }]),
});
await communicate(parent.id, {
  action: "request",
  target: { system: "app-data" },
  topic: "set",
  responseMode: "data",
  data: { version: getAppData(app.id).version, data: { ...data, updated: 3 } },
});
await until(() => (getAppData(invalidApp.id).data as any).mirrored === true);
await Bun.sleep(30);
for (const scenario of ["missing-state", "conflict"] as const) {
  let attempts = 0;
  fake = async () => {
    attempts++;
    if (scenario === "conflict")
      await setAppData(invalidApp.id, {
        version: getAppData(invalidApp.id).version,
        data: { saved: "newer" },
      });
    return {
      ok: true,
      text:
        html("Saved stale data") +
        block([
          ...(scenario === "conflict" ? [{ type: "app-state", data: { saved: "stale" } }] : []),
          { type: "notify", title: "Must not run" },
        ]),
    };
  };
  const start = frames.length;
  bus.emit("op.received", { windowId: w.id, op: { id: scenario, kind: "submit", action: "save" } });
  await until(() =>
    frames
      .slice(start)
      .some((f) => f.type === "s2c.ui.busy" && f.payload.windowId === w.id && !f.payload.busy),
  );
  assert.equal(attempts, scenario === "conflict" ? 1 : 2);
  assert(
    !frames.slice(start).some((f) => f.type === "s2c.ui.patch" || f.type === "s2c.syscall.notify"),
  );
  assert.equal(getMemory(w.id)?.htmlSnapshot, '<main data-vibeos-region="root">Keep input</main>');
}
assert.deepEqual(getAppData(invalidApp.id).data, { saved: "newer" });
assert.equal(listOpenWindows().filter((w) => w.appId === app.id).length, 1);
console.log(
  "App workflow passed: legacy initialization, automatic propagation, preserved identity, optional close, no-op writes and conflict guards",
);
