import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("v1 shortcuts migrate with backup and positions, then follow the real desktop and Trash", () => {
  const root = mkdtempSync(join(tmpdir(), "vibeos-shortcuts-test-"));
  const run = (phase: string) =>
    Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
    import { strict as assert } from "node:assert";
    import { Database } from "bun:sqlite";
    import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
    import { getDb, closeDb } from "./apps/backend/src/db/database.ts";
    import { migrate } from "./apps/backend/src/db/migrate.ts";
    import { backupBeforeStorageMigration, hasSystemDiskVersion } from "./apps/backend/src/db/legacyData.ts";
    import { migrateSystemDisk } from "./apps/backend/src/db/repositories/StorageRepo.ts";
    import { installApp, getApp } from "./apps/backend/src/db/repositories/AppRepo.ts";
    import { ensureShortcut, getNode, moveNode, mutateDisk, syncDesktopFiles, listByLocation } from "./apps/backend/src/db/repositories/VfsRepo.ts";
    import { getSnapshot } from "./apps/backend/src/db/repositories/AppMemoryRepo.ts";
    import { openDiskFile } from "./apps/backend/src/server/filesHandlers.ts";
    import { ensureDiskLayout, writeContent } from "./apps/backend/src/files/content.ts";
    import { diskPath, executeDisk } from "./apps/backend/src/files/disk.ts";
    import { readShortcut } from "./apps/backend/src/files/shortcuts.ts";
    import { env } from "./apps/backend/src/config/env.ts";
    const db = getDb();
    migrate(db); ensureDiskLayout();
    if (process.env.PHASE === "migrate") {
      const app = await installApp({ name: "Saved Notes", manifest: { seedHtml: "<main>saved view</main>" } });
      for (const [id, location, appId] of [["s1", "desktop", app.id], ["s2", "recyclebin", app.id], ["s3", "desktop", "missing-app"]]) {
        db.query("INSERT INTO vfs_nodes (id,name,type,target_app_id,location,x,y,deleted_at,meta_json,created_at,updated_at) VALUES (?, 'Notes','shortcut',?,?,16,224,?, '{\\"icon\\":\\"notebook-pen\\"}',1,2)")
          .run(id,appId,location,location === "recyclebin" ? 123 : null);
      }
      writeContent("System/storage.json", JSON.stringify({version:1}));
      writeContent("Desktop/Notes.vibelink", "existing user content");
      db.query("INSERT INTO storage_version VALUES (1,NULL,1)").run();
      const backup = backupBeforeStorageMigration(db, env);
      assert(backup && existsSync(backup + "/vibeos.db"));
      const old = new Database(backup + "/vibeos.db",{readonly:true});
      assert.equal(old.query("SELECT count(*) n FROM vfs_nodes WHERE type='shortcut'").get().n,3);
      assert.equal(old.query("SELECT max(version) v FROM storage_version").get().v,1); old.close();
      await migrateSystemDisk(backup);
      assert(hasSystemDiskVersion(db,2));
      for (const id of ["s1","s2","s3"]) {
        const node = getNode(id);
        assert.equal(node.x,16); assert.equal(node.y,224);
        assert.equal(node.createdAt,1);
        const path = node.meta.diskTrashId ? "Trash/" + node.meta.diskTrashId + "/item" : node.meta.diskPath;
        assert.equal(readShortcut(diskPath(path,true)).appId,node.targetAppId);
      }
      assert.equal(getNode("s2").location,"recyclebin"); assert.equal(getNode("s2").deletedAt,123);
      assert.equal(readFileSync(diskPath("Desktop/Notes.vibelink"),"utf8"),"existing user content");
      assert.throws(() => readShortcut(diskPath("Desktop/Notes.vibelink")), /shortcut/);
      const link = getNode("s1");
      const opened = await openDiskFile(link.meta.diskPath);
      assert.equal(opened.appId,app.id); assert.equal(getSnapshot(opened.id),"<main>saved view</main>");
      await assert.rejects(openDiskFile(getNode("s3").meta.diskPath), /missingApp/);
      await mutateDisk({action:"move",path:link.meta.diskPath,destination:"Desktop/Renamed.vibelink"});
      assert.equal(getNode("s1").name,"Renamed");
      const trashed = await mutateDisk({action:"trash",path:"Desktop/Renamed.vibelink"});
      assert.equal(getNode("s1").location,"recyclebin"); assert(getApp(app.id).isInstalled);
      assert.equal(executeDisk({action:"list",path:"Trash"}).entries.find(e=>e.path===trashed.result.path).kind,"shortcut");
      const replacement = await ensureShortcut(app.id,"Renamed",app.icon);
      assert.notEqual(replacement.id,"s1");
      await mutateDisk({action:"trash",path:replacement.meta.diskPath});
      assert.equal(getNode("s1").meta.diskTrashId,trashed.result.path);
      assert.notEqual(getNode(replacement.id).meta.diskTrashId,trashed.result.path);
      await moveNode({nodeId:"s1",location:"desktop"});
      assert(existsSync(diskPath("Desktop/Renamed.vibelink"))); assert.equal(getNode("s1").x,16);
      assert.equal((await ensureShortcut(app.id,app.name,app.icon)).id,"s1");
      await mutateDisk({action:"move",path:"Desktop/Renamed.vibelink",destination:"Documents/Renamed.vibelink"});
      assert.equal(getNode("s1").location,"folder");
      const copied = await mutateDisk({action:"copy",path:"Documents/Renamed.vibelink",destination:"Desktop/Copy.vibelink"});
      assert(copied.nodes.some(n=>n.type==="shortcut" && n.targetAppId===app.id));
      writeFileSync(diskPath("Desktop/External.txt"),"external"); await syncDesktopFiles();
      assert(listByLocation("desktop").some(n=>n.name==="External.txt"));
      unlinkSync(diskPath("Desktop/External.txt")); await syncDesktopFiles();
      assert(!listByLocation("desktop").some(n=>n.name==="External.txt"));
    } else {
      assert.equal(backupBeforeStorageMigration(db,env),undefined);
      const before = db.query("SELECT * FROM storage_version ORDER BY version").all();
      await migrateSystemDisk();
      assert.deepEqual(db.query("SELECT * FROM storage_version ORDER BY version").all(),before);
      assert.equal(readdirSync(env.runtimeDir + "/backups").length,1);
      assert.equal(getNode("s2").location,"recyclebin");
    }
    closeDb();
  `,
      ],
      {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          PHASE: phase,
          VIBEOS_DATA_DIR: root,
          VIBEOS_DB_PATH: join(root, "runtime/vibeos.db"),
          VIBEOS_AI_STUB: "1",
          VIBEOS_AGENTS_DISABLED: "1",
        },
      },
    );
  try {
    for (const phase of ["migrate", "restart"]) {
      const result = run(phase);
      if (result.exitCode) throw new Error(result.stdout.toString() + result.stderr.toString());
      expect(result.exitCode).toBe(0);
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});
