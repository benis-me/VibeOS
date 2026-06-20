import { test, expect, beforeAll } from "bun:test";
import { migrate } from "../db/migrate.ts";
import { getDb } from "../db/database.ts";
import { execute } from "./SyscallInterpreter.ts";
import * as AppRepo from "../db/repositories/AppRepo.ts";
import * as VfsRepo from "../db/repositories/VfsRepo.ts";
import * as NotificationRepo from "../db/repositories/NotificationRepo.ts";

// The test DB path + offline stub are set by test/setup.ts (bun preload).
beforeAll(() => {
  migrate(getDb());
});

test("install: adds an app and a desktop shortcut", async () => {
  await execute([{ type: "install", name: "Test Calc", icon: "calculator" }], {
    source: "syscall",
  });
  const app = AppRepo.listApps().find((a) => a.name === "Test Calc");
  expect(app).toBeDefined();
  const desktop = VfsRepo.listByLocation("desktop");
  expect(desktop.some((n) => n.type === "shortcut" && n.targetAppId === app?.id)).toBe(true);
});

test("create-file: creates a node on the desktop", async () => {
  await execute([{ type: "create-file", name: "todo.txt", content: "hi" }], { source: "syscall" });
  expect(VfsRepo.listByLocation("desktop").some((n) => n.name === "todo.txt")).toBe(true);
});

test("notify: creates a notification", async () => {
  await execute([{ type: "notify", title: "Ping", body: "pong" }], { source: "syscall" });
  expect(NotificationRepo.listRecent(50).some((n) => n.title === "Ping")).toBe(true);
});

test("a failing call is swallowed, not thrown (batch keeps going)", async () => {
  await expect(
    execute([{ type: "focus", windowId: "does-not-exist" }], { source: "syscall" }),
  ).resolves.toBeUndefined();
});
