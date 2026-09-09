import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("old and partially exported installations migrate with backup, retry, disk reads and restart idempotency", () => {
  const root = mkdtempSync(join(tmpdir(), "vibeos-storage-test-"));
  const path = join(root, "runtime/vibeos.db");
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  const migrations = fileURLToPath(new URL("./migrations", import.meta.url));
  for (const file of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql") && Number(file.slice(0, 4)) <= 10)
    .sort()) {
    db.exec(readFileSync(join(migrations, file), "utf8"));
  }
  db.exec(
    "CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (10)",
  );
  db.query(
    "INSERT INTO apps (id,name,kind,icon,manifest_json,is_installed,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1)",
  ).run(
    "notes",
    "Notes",
    "virtual",
    "notepad",
    JSON.stringify({ seedHtml: "<main>saved app</main>", defaultSize: { w: 600, h: 400 } }),
    1,
  );
  db.exec(
    "INSERT INTO apps (id,name,kind,icon,manifest_json,is_installed,created_at,updated_at) VALUES ('__transient__','Window','virtual','app-window','{}',0,1,1)",
  );
  for (const [id, appId, title] of [
    ["n1", "notes", "Notes"],
    ["w1", "__transient__", "生成窗口"],
    ["w2", "__transient__", "已关闭的窗口"],
  ]) {
    db.query(
      "INSERT INTO windows (id,app_id,title,w,h,is_open,opened_at,updated_at) VALUES (?,?,?,640,480,?,1,1)",
    ).run(id!, appId!, title!, id === "w2" ? 0 : 1);
    db.query(
      "INSERT INTO app_memory (window_id,app_id,html_snapshot,episode_summary,updated_at) VALUES (?,?,?,'summary',1)",
    ).run(id!, appId!, `<main>${title}</main>`);
  }
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/c+0AAAAASUVORK5CYII=",
    "base64",
  );
  db.query("INSERT INTO images VALUES ('image-1','old prompt','old model','image/png',?,1)").run(
    png,
  );
  db.exec(
    'INSERT INTO settings (id, provider, user_profile, profile_entries_json,updated_at) VALUES (\'singleton\',\'openrouter\',\'old profile\',\'[{"id":"p","content":"preserved profile","enabled":true}]\',1)',
  );
  const trashId = "00000000-0000-0000-0000-000000000001";
  for (const [id, name, location, meta] of [
    ["f1", "old.txt", "desktop", {}],
    ["f2", "edited.txt", "desktop", { diskPath: "Desktop/edited.txt" }],
    ["f3", "trashed.txt", "recyclebin", { diskPath: "Desktop/trashed.txt", diskTrashId: trashId }],
    ["f4", "interrupted.txt", "recyclebin", { diskPath: "Desktop/interrupted.txt" }],
    ["f5", "old-recycled.txt", "recyclebin", {}],
  ]) {
    db.query(
      "INSERT INTO vfs_nodes (id,name,type,content,location,meta_json,created_at,updated_at) VALUES (?,?,'file','old text',?,?,1,1)",
    ).run(id as string, name as string, location as string, JSON.stringify(meta));
  }
  db.close();
  mkdirSync(join(root, "disk/Desktop"), { recursive: true });
  writeFileSync(join(root, "disk/Desktop/edited.txt"), "edited after the partial export");
  mkdirSync(join(root, `disk/.Trash/${trashId}`), { recursive: true });
  writeFileSync(
    join(root, `disk/.Trash/${trashId}/info.json`),
    JSON.stringify({ path: "Desktop/trashed.txt" }),
  );
  writeFileSync(join(root, `disk/.Trash/${trashId}/item`), "old text");
  const interruptedId = "00000000-0000-0000-0000-000000000002";
  mkdirSync(join(root, `disk/.Trash/${interruptedId}`), { recursive: true });
  writeFileSync(
    join(root, `disk/.Trash/${interruptedId}/info.json`),
    JSON.stringify({ path: "Desktop/interrupted.txt" }),
  );
  writeFileSync(join(root, `disk/.Trash/${interruptedId}/item`), "old text");
  mkdirSync(join(root, "runtime/cache"));
  writeFileSync(join(root, "runtime/cache/unfinished.txt"), "cache contents");

  const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
  const run = (phase: string) => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
      import { strict as assert } from "node:assert";
      import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
      import { dirname } from "node:path";
      import { getDb, closeDb } from "./apps/backend/src/db/database.ts";
      import { migrate } from "./apps/backend/src/db/migrate.ts";
      import { backupBeforeStorageMigration, hasSystemDiskVersion } from "./apps/backend/src/db/legacyData.ts";
      import { migrateSystemDisk } from "./apps/backend/src/db/repositories/StorageRepo.ts";
      import { getApp, installApp } from "./apps/backend/src/db/repositories/AppRepo.ts";
      import { getSnapshot, saveSnapshot } from "./apps/backend/src/db/repositories/AppMemoryRepo.ts";
      import { getImage, putImage } from "./apps/backend/src/db/repositories/ImagesRepo.ts";
      import { mutateDisk } from "./apps/backend/src/db/repositories/VfsRepo.ts";
      import { diskPath, executeDisk } from "./apps/backend/src/files/disk.ts";
      import { env } from "./apps/backend/src/config/env.ts";
      const db = getDb();
      const backup = backupBeforeStorageMigration(db, env);
      migrate(db);
      if (process.env.PHASE === "conflict") {
        const path = diskPath("Applications/Notes--notes/app.json");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "existing user file");
        await assert.rejects(migrateSystemDisk(backup), /overwrite/);
        assert.equal(hasSystemDiskVersion(db), false);
        assert.equal(JSON.parse(db.query("SELECT manifest_json FROM apps WHERE id='notes'").get().manifest_json).seedHtml, "<main>saved app</main>");
        assert.equal(readFileSync(path, "utf8"), "existing user file");
        assert(backup && existsSync(backup + "/vibeos.db"));
      } else if (process.env.PHASE === "migrate") {
        await migrateSystemDisk(backup);
        assert(hasSystemDiskVersion(db));
        assert.equal(getApp("notes").manifest.seedHtml, "<main>saved app</main>");
        assert.equal(getSnapshot("w1"), "<main>生成窗口</main>");
        assert.equal(getSnapshot("w2"), "<main>已关闭的窗口</main>");
        assert.equal(getImage("image-1").bytes.toString("base64"), "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/c+0AAAAASUVORK5CYII=");
        assert.equal(db.query("SELECT count(*) n FROM app_memory WHERE html_snapshot != ''").get().n, 0);
        assert.equal(db.query("SELECT sum(length(bytes)) n FROM images").get().n, 0);
        assert.equal(db.query("SELECT count(*) n FROM apps WHERE manifest_json != '{}'").get().n, 0);
        assert.equal(db.query("SELECT count(*) n FROM vfs_nodes WHERE content IS NOT NULL").get().n, 0);
        assert.equal(readFileSync(diskPath("Desktop/edited.txt"), "utf8"), "edited after the partial export");
        assert.equal(readFileSync(diskPath("Desktop/old.txt"), "utf8"), "old text");
        assert.equal(readFileSync(diskPath("Cache/unfinished.txt"), "utf8"), "cache contents");
        assert.equal(executeDisk({ action: "list", path: "Trash" }).entries.length, 3);
        for (const name of ["System", "Documents", "Medias", "Applications", "Trash", "Cache", "Desktop"]) assert(executeDisk({ action: "list", path: "" }).entries.some(e => e.name === name && e.kind === "directory"));
        writeFileSync(diskPath("Applications/Notes--notes/index.html"), "<main>edited on disk</main>");
        assert.equal(getApp("notes").manifest.seedHtml, "<main>edited on disk</main>");
        await saveSnapshot("n1", "<main>new generation</main>");
        assert.equal(getSnapshot("n1"), "<main>new generation</main>");
        assert.equal(db.query("SELECT html_snapshot FROM app_memory WHERE window_id='n1'").get().html_snapshot, "");
        await putImage({ id:"new-image", prompt:"new", model:"test", mime:"image/png", bytes: new Uint8Array([1,2,3]) });
        assert.equal(readFileSync(diskPath("Medias/Images/new-image.png")).length, 3);
        const newApp = await installApp({ name:"New app", manifest:{ seedHtml:"new seed" } });
        assert.equal(getApp(newApp.id).manifest.seedHtml, "new seed");
        await mutateDisk({ action:"move", path:"Applications/Notes--notes", destination:"Applications/My notes" });
        assert.equal(getApp("notes").manifest.seedHtml, "<main>edited on disk</main>");
        assert.equal(getSnapshot("n1"), "<main>new generation</main>");
        const trash = await mutateDisk({ action:"trash", path:"Applications/My notes" });
        assert.equal(getApp("notes"), null);
        await mutateDisk({ action:"restore", path:trash.result.path });
        assert.equal(getApp("notes").manifest.seedHtml, "<main>edited on disk</main>");
      } else {
        assert.equal(backup, undefined);
        const before = db.query("SELECT * FROM storage_version").get();
        await migrateSystemDisk();
        assert.deepEqual(db.query("SELECT * FROM storage_version").get(), before);
        assert.equal(getSnapshot("n1"), "<main>new generation</main>");
        assert.equal(getApp("notes").manifest.seedHtml, "<main>edited on disk</main>");
      }
      closeDb();
    `,
      ],
      {
        cwd,
        env: {
          ...process.env,
          PHASE: phase,
          NODE_OPTIONS: "",
          VIBEOS_DATA_DIR: root,
          VIBEOS_DB_PATH: path,
          VIBEOS_AI_STUB: "1",
          VIBEOS_AGENTS_DISABLED: "1",
        },
      },
    );
    if (result.exitCode !== 0) throw new Error(result.stderr.toString() + result.stdout.toString());
  };
  try {
    run("conflict");
    rmSync(join(root, "disk/Applications/Notes--notes/app.json"));
    run("migrate");
    run("restart");
    const backups = readdirSync(join(root, "runtime/backups"));
    expect(backups.length).toBe(1);
    const backup = new Database(join(root, "runtime/backups", backups[0]!, "vibeos.db"), {
      readonly: true,
    });
    expect(
      backup
        .query<{ html_snapshot: string }, []>(
          "SELECT html_snapshot FROM app_memory WHERE window_id='n1'",
        )
        .get()!.html_snapshot,
    ).toBe("<main>Notes</main>");
    expect(backup.query<{ n: number }, []>("SELECT length(bytes) n FROM images").get()!.n).toBe(
      png.length,
    );
    expect(
      backup.query<{ user_profile: string }, []>("SELECT user_profile FROM settings").get()!
        .user_profile,
    ).toBe("old profile");
    backup.close();
  } finally {
    rmSync(root, { recursive: true });
  }
});
