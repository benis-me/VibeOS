import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { diskPath, executeDisk } from "./disk.ts";
import { getDb } from "../db/database.ts";
import { migrate } from "../db/migrate.ts";
import {
  createNode,
  getNode,
  migrateVirtualFiles,
  mutateDisk,
} from "../db/repositories/VfsRepo.ts";
import { allowedOrigin } from "../server/requestOrigin.ts";
import { env } from "../config/env.ts";
import { NATIVE_PRESET_APPS } from "@vibeos/shared/domain";
import { parseClientMessage } from "@vibeos/shared/protocol";

test("Files hides host metadata and keeps binary files distinct from directories", () => {
  const root = `metadata-${randomUUID()}`;
  mkdirSync(diskPath(root));
  try {
    writeFileSync(diskPath(`${root}/.DS_Store`), Buffer.from([0, 1, 255]));
    writeFileSync(diskPath(`${root}/._photo.png`), "host metadata");
    writeFileSync(diskPath(`${root}/photo.png`), Buffer.from([0, 1, 255]));
    const entries = executeDisk({ action: "list", path: root }).entries!;
    expect(entries.map((e) => e.name)).toEqual(["photo.png"]);
    expect(entries[0]!.kind).toBe("file");
  } finally {
    rmSync(diskPath(root), { recursive: true });
  }
});

test("real disk edits preserve concurrent changes, binary data, names and reversible deletion", () => {
  const root = `files-${randomUUID()}`;
  executeDisk({ action: "mkdir", path: root });
  try {
    const path = `${root}/中文.txt`;
    executeDisk({ action: "write", path, content: "original" });
    expect(readFileSync(diskPath(path), "utf8")).toBe("original");
    const opened = executeDisk({ action: "read", path });
    writeFileSync(diskPath(path), "external edit");
    expect(() =>
      executeDisk({ action: "write", path, content: "stale", version: opened.version }),
    ).toThrow("conflict");
    expect(readFileSync(diskPath(path), "utf8")).toBe("external edit");
    const fresh = executeDisk({ action: "read", path });
    executeDisk({ action: "write", path, content: "saved", version: fresh.version });
    expect(() => executeDisk({ action: "write", path, content: "replace" })).toThrow("exists");
    const moved = `${root}/renamed.txt`;
    executeDisk({ action: "move", path, destination: moved });
    executeDisk({ action: "copy", path: moved, destination: path });
    expect(executeDisk({ action: "list", path: root }).entries?.length).toBe(2);
    const deleted = executeDisk({ action: "trash", path: moved }).path!;
    expect(existsSync(diskPath(moved))).toBe(false);
    expect(
      executeDisk({ action: "list", path: ".Trash" }).entries?.find((e) => e.path === deleted)
        ?.originalPath,
    ).toBe(moved);
    executeDisk({ action: "write", path: moved, content: "new owner" });
    expect(() => executeDisk({ action: "restore", path: deleted })).toThrow("exists");
    rmSync(diskPath(moved));
    executeDisk({ action: "restore", path: deleted });
    expect(readFileSync(diskPath(moved), "utf8")).toBe("saved");
    const deletedAgain = executeDisk({ action: "trash", path: moved }).path!;
    executeDisk({ action: "delete", path: deletedAgain });
    expect(
      executeDisk({ action: "list", path: ".Trash" }).entries?.some((e) => e.path === deletedAgain),
    ).toBe(false);
    const binary = `${root}/bytes.bin`;
    executeDisk({ action: "write", path: binary, content: "AAH/", encoding: "base64" });
    expect([...readFileSync(diskPath(binary))]).toEqual([0, 1, 255]);
    expect(() => executeDisk({ action: "read", path: binary })).toThrow("binary");
    expect(() =>
      executeDisk({ action: "write", path: `${root}/bad.bin`, content: "***", encoding: "base64" }),
    ).toThrow("encoding");
  } finally {
    rmSync(diskPath(root), { recursive: true });
  }
});

test("filesystem boundary blocks traversal, symlinks, unsafe origins and incomplete commands", () => {
  const root = `boundary-${randomUUID()}`;
  const outside = join(env.runtimeDir, `${root}.txt`);
  mkdirSync(diskPath(root));
  writeFileSync(outside, "private runtime data");
  try {
    symlinkSync(outside, diskPath(`${root}/link`));
    expect(executeDisk({ action: "list", path: root }).entries?.[0]?.kind).toBe("symlink");
    for (const path of [
      "../runtime/vibeos.db",
      "/etc/passwd",
      "a/../../x",
      "a\\..\\x",
      ".Trash/item",
      `${root}/link`,
    ]) {
      expect(() => executeDisk({ action: "read", path })).toThrow();
      expect(() => executeDisk({ action: "write", path, content: "bad" })).toThrow();
    }
    expect(() => executeDisk({ action: "trash", path: "" })).toThrow("path");
    expect(() => executeDisk({ action: "move", path: root, destination: `${root}/child` })).toThrow(
      "path",
    );
    expect(readFileSync(outside, "utf8")).toBe("private runtime data");
    const request = (origin: string) =>
      new Request(`http://127.0.0.1:${env.port}/ws`, { headers: { Origin: origin } });
    expect(allowedOrigin(request(`http://localhost:${env.port + 10}`))).toBe(true);
    expect(allowedOrigin(request("https://unrelated.example"))).toBe(false);
    expect(allowedOrigin(request("null"))).toBe(false);
    expect(
      parseClientMessage({
        type: "c2s.files.request",
        payload: { requestId: "x", command: { action: "move", path: "a" } },
      }),
    ).toBeNull();
    expect(NATIVE_PRESET_APPS).toContain("file-manager");
  } finally {
    rmSync(diskPath(root), { recursive: true });
    rmSync(outside);
  }
});

test("legacy files materialize once and desktop references follow Files mutations", async () => {
  migrate(getDb());
  const name = `legacy-${randomUUID()}.txt`;
  const node = await createNode({ name, type: "file", content: "legacy body" });
  const occupied = String(node.meta.diskPath);
  expect(readFileSync(diskPath(occupied), "utf8")).toBe("legacy body");
  writeFileSync(diskPath(occupied), "existing physical file");
  // Recreate the pre-upgrade row shape and a same-named physical file.
  getDb()
    .query("UPDATE vfs_nodes SET meta_json = '{}', content = 'legacy body' WHERE id = ?")
    .run(node.id);
  await migrateVirtualFiles();
  const original = String(getNode(node.id)!.meta.diskPath);
  expect(original).not.toBe(occupied);
  expect(readFileSync(diskPath(occupied), "utf8")).toBe("existing physical file");
  expect(readFileSync(diskPath(original), "utf8")).toBe("legacy body");
  const renamed = `${original}.renamed`;
  await mutateDisk({ action: "move", path: original, destination: renamed });
  expect(getNode(node.id)?.meta.diskPath).toBe(renamed);
  expect(getNode(node.id)?.name).toBe(renamed.split("/").at(-1)!);
  const trashed = await mutateDisk({ action: "trash", path: renamed });
  expect(getNode(node.id)?.location).toBe("recyclebin");
  await mutateDisk({ action: "restore", path: trashed.result.path! });
  expect(getNode(node.id)?.location).toBe("desktop");
  writeFileSync(diskPath(renamed), "new disk content");
  await migrateVirtualFiles();
  expect(readFileSync(diskPath(renamed), "utf8")).toBe("new disk content");
  rmSync(diskPath(renamed));
  await migrateVirtualFiles();
  expect(existsSync(diskPath(renamed))).toBe(false);
  expect(getNode(node.id)?.content).toBe("legacy body");
  rmSync(diskPath(occupied));
});
