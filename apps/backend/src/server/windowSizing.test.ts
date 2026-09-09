import { expect, test } from "bun:test";
import { makeEnvelope, parseClientMessage } from "@vibeos/shared/protocol";
import { parseAppSearchResults } from "../ai/appSearch.ts";
import { parseAiOutput } from "../ai/streamParser.ts";
import { migrate } from "../db/migrate.ts";
import { getDb } from "../db/database.ts";
import { getApp, listApps } from "../db/repositories/AppRepo.ts";
import {
  getWindow,
  listOpenWindows,
  moveWindow,
  openWindow,
  rememberGeometry,
} from "../db/repositories/WindowRepo.ts";
import { saveSnapshot } from "../db/repositories/AppMemoryRepo.ts";
import { execute } from "../syscall/SyscallInterpreter.ts";
import { handleAppLaunch, handleAppSave } from "./appHandlers.ts";

test("app search carries per-app sizes and rejects malformed sizing at the WebSocket boundary", () => {
  const results = parseAppSearchResults(
    JSON.stringify({
      results: [
        { name: "Small timer", kind: "widget", defaultSize: { w: 320, h: 240 } },
        { name: "Wide workspace", kind: "app", defaultSize: { w: 1120, h: 740 } },
        { name: "Legacy result" },
        { name: "Bad dimensions", defaultSize: { w: "large", h: -1 } },
        null,
      ],
    }),
  );
  expect(results).toHaveLength(4);
  expect(results.map((r) => r.defaultSize)).toEqual([
    { w: 320, h: 240 },
    { w: 1120, h: 740 },
    undefined,
    undefined,
  ]);
  const message = (size: unknown) => makeEnvelope("c2s.app.launch", { name: "Test", size }, "test");
  expect(parseClientMessage(message({ w: 1120, h: 740 }))?.payload).toEqual({
    name: "Test",
    size: { w: 1120, h: 740 },
  });
  for (const size of [{ w: NaN, h: 300 }, { w: 500, h: -1 }, { w: 500 }, { w: "500", h: 300 }]) {
    expect(parseClientMessage(message(size))).toBeNull();
  }
  const parsed = parseAiOutput(
    '```vibeos-syscall\n{"calls":[{"type":"resize-window","size":{"w":420,"h":560}}]}\n```',
  );
  expect(parsed.syscalls).toEqual([{ type: "resize-window", size: { w: 420, h: 560 } }]);
});

test("suggested, generated and user-resized dimensions survive launch and app saving", async () => {
  migrate(getDb());
  await handleAppLaunch({ name: "Sizing timer", widget: true, size: { w: 320, h: 240 } });
  await handleAppLaunch({ name: "Sizing workspace", size: { w: 1120, h: 740 } });
  const timer = listOpenWindows().find((w) => w.title === "Sizing timer")!;
  const workspace = listOpenWindows().find((w) => w.title === "Sizing workspace")!;
  expect([timer.rect.w, timer.rect.h]).toEqual([320, 240]);
  expect([workspace.rect.w, workspace.rect.h]).toEqual([1120, 740]);
  await saveSnapshot(workspace.id, '<div data-vibeos-region="root">Saved workspace</div>');
  await execute([{ type: "resize-window", size: { w: 960, h: 680 } }], {
    windowId: workspace.id,
    source: "syscall",
    resizeFrom: workspace.rect,
  });
  expect([getWindow(workspace.id)!.rect.w, getWindow(workspace.id)!.rect.h]).toEqual([960, 680]);
  // A later interaction is not allowed to change the user's window size.
  await execute([{ type: "resize-window", size: { w: 600, h: 400 } }], {
    windowId: workspace.id,
    source: "syscall",
  });
  expect(getWindow(workspace.id)!.rect.w).toBe(960);
  // A manual resize while generation is running wins over the model's suggestion.
  const beforeResize = getWindow(workspace.id)!.rect;
  await moveWindow(workspace.id, { ...beforeResize, w: 1000, h: 720 });
  await execute([{ type: "resize-window", size: { w: 600, h: 400 } }], {
    windowId: workspace.id,
    source: "syscall",
    resizeFrom: beforeResize,
  });
  expect(getWindow(workspace.id)!.rect.w).toBe(1000);
  await handleAppSave({ windowId: workspace.id, name: "Saved sizing workspace" });
  const app = listApps().find((a) => a.name === "Saved sizing workspace")!;
  expect(app.manifest.defaultSize).toEqual({ w: 1000, h: 720 });
  expect(app.manifest.seedHtml).toContain("Saved workspace");
  const reopened = await openWindow({
    appId: app.id,
    title: app.name,
    size: app.manifest.defaultSize,
  });
  expect([reopened.rect.w, reopened.rect.h]).toEqual([1000, 720]);
  await rememberGeometry(app.id, { x: 20, y: 30, w: 1080, h: 760 });
  const remembered = await openWindow({
    appId: app.id,
    title: app.name,
    size: getApp(app.id)!.manifest.defaultSize,
  });
  expect(remembered.rect).toEqual({ x: 20, y: 30, w: 1080, h: 760 });
  await handleAppLaunch({ name: "Old client launch" });
  const legacy = listOpenWindows().find((w) => w.title === "Old client launch")!;
  expect([legacy.rect.w, legacy.rect.h]).toEqual([820, 580]);
});
