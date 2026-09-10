// Real disk/database regressions with local fake model/CLI output. Run via reliability.test.ts.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { getDb, closeDb } from "../apps/backend/src/db/database.ts";
import { migrate } from "../apps/backend/src/db/migrate.ts";
import { ensureSettings } from "../apps/backend/src/db/repositories/SettingsRepo.ts";
import { ensureDiskLayout, writeContent } from "../apps/backend/src/files/content.ts";
import { executeDisk, diskPath, watchDisk } from "../apps/backend/src/files/disk.ts";
import { installApp, seedPresets } from "../apps/backend/src/db/repositories/AppRepo.ts";
import { openWindow, closeWindow } from "../apps/backend/src/db/repositories/WindowRepo.ts";
import { ensureMemory, saveSnapshot, addInteraction, consolidationCursor, saveSummary, getMemory } from "../apps/backend/src/db/repositories/AppMemoryRepo.ts";
import { getProvider, setActiveProvider, availableProviderIds } from "../apps/backend/src/ai/providers/index.ts";
import { changeSystemMemory } from "../apps/backend/src/db/repositories/SystemMemoryRepo.ts";
import { broadcastDiskChanges, executeFileCommand } from "../apps/backend/src/server/filesHandlers.ts";
import { registerCommunication, communicate } from "../apps/backend/src/events/communication.ts";
import { registerUiGenerationAgent } from "../apps/backend/src/agents/UiGenerationAgent.ts";
import { MaintenanceAgent } from "../apps/backend/src/agents/MaintenanceAgent.ts";
import { bus, messageContext } from "../apps/backend/src/events/bus.ts";
import * as Agents from "../apps/backend/src/db/repositories/AgentRepo.ts";
import { codexProvider } from "../apps/backend/src/ai/providers/codex.ts";
import { AnthropicCliProvider } from "../apps/backend/src/ai/providers/cli/AnthropicCliProvider.ts";
import type { ProviderRunOptions, RunResult } from "../apps/backend/src/ai/providers/types.ts";
import { getAppData } from "../apps/backend/src/db/repositories/ApplicationRepo.ts";
import { enqueue } from "../apps/backend/src/db/repositories/writeQueue.ts";
import * as Syscalls from "../apps/backend/src/syscall/SyscallInterpreter.ts";
import type { ServerToClient } from "@vibeos/shared/protocol";

async function until(predicate: () => unknown) {
  for (let i = 0; i < 300 && !predicate(); i++) await Bun.sleep(5);
  assert(predicate(), "operation completed before timeout");
}
migrate(getDb()); ensureDiskLayout(); await ensureSettings(); await seedPresets();

// Every existing host filesystem component is canonicalized, not only the input string.
writeContent("System/protected.txt", "original");
if (existsSync(diskPath("system/protected.txt"))) {
  const version = executeDisk({ action: "read", path: "System/protected.txt" }).version!;
  for (const path of ["System/protected.txt", "system/protected.txt", "SYSTEM/protected.txt"])
    assert.throws(() => executeDisk({ action: "write", path, version, content: "changed" }), /systemFolder/);
  for (const action of ["move", "copy"] as const)
    assert.throws(() => executeDisk({ action, path: "System/protected.txt", destination: "system/new.txt" }), /systemFolder/);
  assert.equal(readFileSync(diskPath("System/protected.txt"), "utf8"), "original");
}

// CLI text is provisional until a terminal success AND a zero exit status.
const binDir = diskPath("Cache/test-bin"); mkdirSync(binDir, { recursive: true });
process.env.PATH = binDir + ":" + process.env.PATH;
const anthropic = new AnthropicCliProvider({ id: "claude", label: "Test", bin: "test-anthropic" });
const text = "<vibeos-html><main>Provisional</main></vibeos-html>";
const codexRun = codexProvider.run.bind(codexProvider);
for (const terminal of ["success", "failure", "missing", "nonzero"] as const) {
  const code = terminal === "nonzero" || terminal === "failure" ? 1 : 0;
  const writeBin = (name: string, frames: unknown[]) => writeFileSync(binDir + "/" + name,
    "#!/bin/sh\ncat >/dev/null\ncat <<'JSONL'\n" + frames.map((x) => JSON.stringify(x)).join("\n") + "\nJSONL\nexit " + code + "\n", { mode: 0o700 });
  writeBin("codex", [{ type: "item.completed", item: { type: "agent_message", text } },
    ...(terminal === "missing" ? [] : [{ type: terminal === "failure" ? "turn.failed" : "turn.completed", error: terminal === "failure" ? { message: "simulated failure" } : undefined }])]);
  writeBin("test-anthropic", [{ type: "assistant", message: { content: [{ type: "text", text }] } },
    ...(terminal === "missing" ? [] : [{ type: "result", subtype: terminal === "failure" ? "error" : "success", is_error: terminal === "failure", result: text }])]);
  for (const result of [await codexRun({ prompt: "test", systemPrompt: "test" }), await anthropic.run({ prompt: "test", systemPrompt: "test" })]) {
    assert.equal(result.ok, terminal === "success", terminal);
    if (!result.ok) assert(result.error, "failed partial output has an error");
  }
}

const app = await installApp({ name: "Reliability" });
const win = await openWindow({ appId: app.id, title: app.name });
await ensureMemory(win.id, app.id); await saveSnapshot(win.id, '<main data-vibeos-region="root">Ready</main>');
await registerCommunication(); registerUiGenerationAgent(); setActiveProvider("codex");
let generations = 0, completed = 0;
let fake: (options: ProviderRunOptions) => Promise<RunResult> = async () => ({ ok: true, text: '<vibeos-html mode="full"><main data-vibeos-region="root">' + (++generations) + '</main></vibeos-html>' });
for (const id of new Set([...availableProviderIds(), "codex"] as const)) (await getProvider(id)).run = (options) => fake(options);
bus.on("system.broadcast", ({ message }) => { if (message.type === "s2c.ui.patch" && message.payload.done) completed++; });
const events: string[][] = [];
bus.on("app.delivery", ({ delivery }) => { if (delivery.topic === "files.changed") events.push((delivery.data as { paths: string[] }).paths); });
executeDisk({ action: "mkdir", path: "Documents/inbox" });
await communicate(win.id, { action: "subscribe", subscription: { id: "inbox", source: { system: true }, topic: "files.changed", path: "Documents/inbox", mode: "ai" } });
await Bun.sleep(100);
const watched: string[][] = [];
const stopWatch = watchDisk((paths) => { watched.push(paths); void broadcastDiskChanges(paths); });
try {
  const before = generations;
  writeContent("System/Sessions/probe.txt", "internal snapshot");
  await executeFileCommand({ action: "write", path: "Medias/unrelated.txt", content: "unrelated" });
  await broadcastDiskChanges();
  await Bun.sleep(350);
  assert.equal(generations, before, "internal, unrelated and generic refreshes do not trigger a filtered app");
  for (const action of ["create", "replace", "move"] as const) {
    await messageContext.run({ id: "own-write", hops: 0, windows: [win.id] }, () =>
      executeFileCommand(action === "move"
        ? { action: "move", path: "Documents/inbox/self.txt", destination: "Documents/inbox/moved.txt" }
        : { action: "write", path: "Documents/inbox/self.txt", content: action,
            ...(action === "replace" ? { version: executeDisk({ action: "read", path: "Documents/inbox/self.txt" }).version! } : {}) }));
    await Bun.sleep(350);
    assert.equal(generations, before, action + ": filesystem echo retains the initiating workflow's suppression: " + JSON.stringify(watched));
  }
  writeFileSync(diskPath("Documents/inbox/external.txt"), "external change");
  await until(() => generations > before);
  await Bun.sleep(400);
  assert.equal(generations, before + 1, "one external change produces one generation, not a snapshot loop");
  assert(events.at(-1)?.includes("Documents/inbox/external.txt"));
  const eventCount = events.length;
  await executeFileCommand({ action: "write", path: "Documents/inbox/a.txt", content: "a" });
  await executeFileCommand({ action: "write", path: "Documents/inbox/b.txt", content: "b" });
  await until(() => events.length > eventCount);
  assert(events.at(-1)?.includes("Documents/inbox/a.txt") && events.at(-1)?.includes("Documents/inbox/b.txt"), "coalescing preserves every changed path");
} finally { stopWatch(); }
await communicate(win.id, { action: "unsubscribe", id: "inbox" });

// Provenance is actual editing events, never prefilled controls or the primary password value.
await changeSystemMemory({ action: "toggle", enabled: true });
const extracted: string[] = [];
fake = async (options) => {
  if (options.prompt.startsWith("[VIBEOS_MEMORY_EXTRACTION]")) { extracted.push(options.prompt); return { ok: true, text: '{"save":[],"remove":[]}' }; }
  return { ok: true, text: '<vibeos-html mode="full"><main data-vibeos-region="root">' + (++generations) + '</main></vibeos-html>' };
};
const op = { kind: "submit" as const, action: "save", value: "FAKE_PASSWORD", formData: { password: "FAKE_PASSWORD", profile: "AI fictional sailor" } };
let before = completed;
bus.emit("op.received", { windowId: win.id, op: { ...op, userInput: [{ key: "password", type: "password", value: "FAKE_PASSWORD" }] } });
await until(() => completed > before); await Bun.sleep(50);
assert.equal(extracted.length, 0);
before = completed;
bus.emit("op.received", { windowId: win.id, op: { ...op, userInput: [{ key: "preference", type: "text", value: "I prefer concise answers." }, { key: "hidden", type: "hidden", value: "AI prefill" }] } });
await until(() => extracted.length > 0);
assert(extracted[0]!.includes("I prefer concise answers."));
assert(!extracted[0]!.includes("FAKE_PASSWORD") && !extracted[0]!.includes("AI fictional sailor") && !extracted[0]!.includes("AI prefill"));
await until(() => completed > before);
await changeSystemMemory({ action: "toggle", enabled: false });
await closeWindow(win.id);

// Notes returned complete sibling regions separated by HTML comments. This must
// commit the first response, not pay for a second, full-window model generation.
const notes = await openWindow({ appId: app.id, title: "Notes region regression" });
await ensureMemory(notes.id, app.id);
await saveSnapshot(notes.id, '<main><header>Unchanged chrome</header><aside data-vibeos-region="notes-sidebar">First</aside><section data-vibeos-region="notes-editor"><textarea>Original</textarea></section></main>');
let notesCalls = 0;
fake = async () => {
  notesCalls++;
  return { ok: true, text: '<vibeos-html mode="regions"><!-- 左侧边栏 --><aside data-vibeos-region="notes-sidebar">Second</aside><!-- 右侧编辑器 --><section data-vibeos-region="notes-editor"><textarea>Updated note</textarea></section></vibeos-html>' };
};
before = completed;
bus.emit("op.received", { windowId: notes.id, op: { kind: "click", action: "select-note", dataset: { id: "2" }, regionPath: ["notes-sidebar"] } });
await until(() => completed > before);
assert.equal(notesCalls, 1, "valid comments never trigger a full-render retry");
assert.equal(getMemory(notes.id)?.htmlSnapshot, '<main><header>Unchanged chrome</header><aside data-vibeos-region="notes-sidebar">Second</aside><section data-vibeos-region="notes-editor"><textarea>Updated note</textarea></section></main>');
await closeWindow(notes.id);

// Review follow-up: validate every action before publishing UI, and acknowledge
// terminal actions only after they succeeded. No model or user's files are used.
const frames: ServerToClient[] = [];
const offFrames = bus.on("system.broadcast", ({ message }) => frames.push(message));
const original = '<main data-vibeos-region="root"><textarea name="body"></textarea><button data-vibeos-action="save">Save</button></main>';
const saved = original.replace('</main>', '<p>Saved</p></main>');
const block = (calls: unknown[]) => '```vibeos-syscall\n' + JSON.stringify({ calls }) + '\n```';
for (const scenario of ["notify", "example", "invalid", "rejected-ui", "conflict"] as const) {
  const window = await openWindow({ appId: app.id, title: scenario });
  await ensureMemory(window.id, app.id); await saveSnapshot(window.id, original);
  const example = block([{ type: "create-file", name: "never-execute.txt", content: "literal example" }]);
  let calls = 0;
  fake = async () => {
    calls++;
    return { ok: true, usage: { inputTokens: 10, outputTokens: 5 }, text:
      scenario === "rejected-ui" ? '<vibeos-html mode="regions">broken</vibeos-html>' :
      '<vibeos-html mode="full">' + (scenario === "example" ? '<main><textarea>' + example + '</textarea></main>' : saved) + '</vibeos-html>' +
      (scenario === "notify" ? block([{ type: "notify", title: "Saved" }]) :
       scenario === "invalid" ? block([{ type: "communication", command: { action: "request", target: { system: "appData" }, topic: "set" } }, { type: "notify", title: "Must not run" }]) :
       scenario === "conflict" ? block([{ type: "communication", command: { action: "request", target: { system: "files" }, topic: "write", responseMode: "data", data: { path: "Documents/nonexistent.txt", version: "stale", content: "not saved" } } }, { type: "notify", title: "Must not run" }]) : '') };
  };
  const start = frames.length;
  bus.emit("op.received", { windowId: window.id, op: { id: scenario, kind: "submit", action: "save", formData: { body: "Keep my input" } } });
  await until(() => frames.slice(start).some((f) => f.type === "s2c.ui.busy" && f.payload.windowId === window.id && !f.payload.busy));
  await Bun.sleep(20);
  const emitted = frames.slice(start);
  const patches = emitted.flatMap((f) => f.type === "s2c.ui.patch" ? [f.payload] : []);
  if (scenario === "notify" || scenario === "example") {
    assert.equal(calls, 1);
    assert.equal(patches.at(-1)?.operationId, scenario, "terminal success acknowledges the submitted draft");
    if (scenario === "notify") assert(emitted.some((f) => f.type === "s2c.syscall.notify"));
    assert(!existsSync(diskPath("Desktop/never-execute.txt")), "displayed instructions never execute");
  } else {
    assert.equal(calls, scenario === "conflict" ? 1 : 2);
    assert.equal(patches.length, 0, "failed instructions cannot publish or acknowledge a success UI");
    assert.equal(getMemory(window.id)?.htmlSnapshot, original);
    assert(!emitted.some((f) => f.type === "s2c.syscall.notify"));
    const runs = Agents.recentRuns(100, undefined, { status: "error" }).filter((r) => r.windowId === window.id);
    assert.equal(runs.length, calls, "validation and execution failures appear in the error filter");
    assert(runs.every((r) => r.inputTokens === 10 && r.outputTokens === 5), "outcome updates retain usage");
  }
  await closeWindow(window.id);
}

// Preemption while the real writer queue is occupied must cancel both file and
// shared application-data writes, including their late AI response.
executeDisk({ action: "write", path: "Documents/preemption.txt", content: "ORIGINAL" });
for (const system of ["files", "app-data"] as const) {
  const window = await openWindow({ appId: app.id, title: "Preemption " + system });
  await ensureMemory(window.id, app.id); await saveSnapshot(window.id, original);
  const current = system === "files" ? executeDisk({ action: "read", path: "Documents/preemption.txt" }) : getAppData(app.id);
  let calls = 0;
  fake = async () => ({ ok: true, text: ++calls === 1 ? block([{ type: "communication", command: {
    action: "request", target: { system }, topic: system === "files" ? "write" : "set", responseMode: "ai",
    data: system === "files" ? { path: "Documents/preemption.txt", version: current.version, content: "STALE" } : { version: current.version, data: { stale: true } },
  } }]) : '<vibeos-html mode="full"><main>Latest operation</main></vibeos-html>' });
  let blocked = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const off = bus.on("system.broadcast", ({ message }) => {
    if (blocked || message.type !== "s2c.activity.changed") return;
    const latest = getDb().query<{ message: string }, [string]>("SELECT message FROM agent_logs WHERE trace_id=? ORDER BY rowid DESC LIMIT 1").get(message.payload.traceId);
    if (latest?.message !== "message.requested") return;
    blocked = true; void enqueue(() => gate);
    bus.emit("op.received", { windowId: window.id, op: { kind: "click", action: "new-operation" } });
  });
  try {
    bus.emit("op.received", { windowId: window.id, op: { kind: "click", action: "old-write" } });
    await until(() => blocked); await Bun.sleep(10); release();
    await until(() => getMemory(window.id)?.htmlSnapshot.includes("Latest operation"));
    await Bun.sleep(25);
    assert.equal(calls, 2, "cancelled requests cannot restart generation with an old response");
    if (system === "files") assert.equal(executeDisk({ action: "read", path: "Documents/preemption.txt" }).content, "ORIGINAL");
    else assert.equal(getAppData(app.id).version, current.version);
  } finally { release(); off(); await closeWindow(window.id); }
}
let releaseWrite!: () => void;
const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
void enqueue(() => writeGate);
let live = true;
const queuedCreate = Syscalls.execute([{ type: "create-file", name: "cancelled-create.txt", content: "stale" }], { source: "syscall", canCommit: () => live });
live = false; releaseWrite(); await queuedCreate;
assert(!existsSync(diskPath("Desktop/cancelled-create.txt")), "legacy create-file also rechecks cancellation inside its writer");
offFrames();

// Successful consolidation records the input watermark; failures and stale results do not.
const maintenanceWindow = await openWindow({ appId: app.id, title: "Maintenance" });
await ensureMemory(maintenanceWindow.id, app.id);
for (let n = 0; n < 6; n++) await addInteraction({ windowId: maintenanceWindow.id, opKind: "click", opPayload: { n } });
let maintenanceCalls = 0;
fake = async () => { maintenanceCalls++; return { ok: true, text: "<vibeos-summary>Consolidated</vibeos-summary>" }; };
await MaintenanceAgent.tick(); assert.equal(maintenanceCalls, 1); assert.equal(consolidationCursor(maintenanceWindow.id), 6);
closeDb(); await MaintenanceAgent.tick(); assert.equal(maintenanceCalls, 1, "restart does not repeat unchanged maintenance");
await addInteraction({ windowId: maintenanceWindow.id, opKind: "click", opPayload: {} });
fake = async () => { await saveSummary(maintenanceWindow.id, "Foreground changed"); return { ok: true, text: "<vibeos-summary>Stale maintenance</vibeos-summary>" }; };
await MaintenanceAgent.tick(); assert.equal(getMemory(maintenanceWindow.id)?.episodeSummary, "Foreground changed"); assert.equal(consolidationCursor(maintenanceWindow.id), 6);
fake = async () => ({ ok: false, text: "partial", error: "simulated failure" });
await MaintenanceAgent.tick(); assert.equal(consolidationCursor(maintenanceWindow.id), 6);
fake = async () => { maintenanceCalls++; return { ok: true, text: "<vibeos-summary>New consolidation</vibeos-summary>" }; };
await MaintenanceAgent.tick(); await MaintenanceAgent.tick(); assert.equal(maintenanceCalls, 2); assert.equal(consolidationCursor(maintenanceWindow.id), 7);

// Server-side filters find older history, with no skipped records at equal timestamps.
const runs = [];
for (let i = 0; i < 5; i++) runs.push(await Agents.startRun({ role: "maintenance", trigger: "timer", appName: "Cursor", traceId: "pagination" }));
getDb().query("UPDATE agent_runs SET started_at=123 WHERE trace_id='pagination'").run();
await Agents.endRun(runs[0]!.id, "error", "test failure");
const first = Agents.recentRuns(2, undefined, { query: "Cursor" });
const second = Agents.recentRuns(3, first.at(-1)!.startedAt, { query: "Cursor" }, first.at(-1)!.id);
assert.equal(new Set([...first, ...second].map((r) => r.id)).size, 5);
assert.equal(Agents.recentRuns(10, undefined, { query: "Cursor", status: "error", role: "maintenance" }).length, 1);
assert.equal(Agents.runDetails("missing"), null);
await Agents.prune(1);
assert(Agents.getRun(runs[1]!.id), "pruning never removes a running operation");
console.log("reliability regressions passed");
