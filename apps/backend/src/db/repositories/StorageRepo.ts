import { existsSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { env } from "../../config/env.ts";
import { getDb } from "../database.ts";
import { hasSystemDiskVersion } from "../legacyData.ts";
import { enqueue } from "./writeQueue.ts";
import { getApp } from "./AppRepo.ts";
import { materializeLegacyFiles } from "./VfsRepo.ts";
import { readShortcut } from "../../files/shortcuts.ts";
import { diskPath } from "../../files/disk.ts";
import {
  appPackagePath,
  ensureDiskLayout,
  imageFile,
  snapshotFile,
  writeAppPackage,
  writeContent,
} from "../../files/content.ts";

/** A versioned data migration, including installations partly exported by the old Files code. */
function migrateDiskContent(backup?: string): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    if (hasSystemDiskVersion(db)) {
      ensureDiskLayout();
      return;
    }
    ensureDiskLayout();
    const oldTrash = diskPath(".Trash", true);
    if (existsSync(oldTrash)) {
      for (const id of readdirSync(oldTrash)) {
        const target = diskPath(`Trash/${id}`, true);
        if (existsSync(target)) throw new Error(`Trash migration conflict: ${id}`);
        renameSync(join(oldTrash, id), target);
      }
      rmdirSync(oldTrash);
    }
    const oldCache = join(env.runtimeDir, "cache");
    if (existsSync(oldCache)) {
      for (const name of readdirSync(oldCache)) {
        const target = diskPath(`Cache/${name}`);
        if (existsSync(target)) throw new Error(`Cache migration conflict: ${name}`);
        renameSync(join(oldCache, name), target);
      }
      rmdirSync(oldCache);
    }
    materializeLegacyFiles();
    const counts = { apps: 0, snapshots: 0, images: 0, files: 0 };
    // Disk files are published and verified before the SQLite transaction points
    // at them. Failed/restarted exports reuse identical files, never overwrite.
    db.transaction(() => {
      for (const row of db
        .query<{ id: string; content_path: string | null }, []>("SELECT id, content_path FROM apps")
        .all()) {
        const app = getApp(row.id)!;
        const path = row.content_path ?? writeAppPackage(app, appPackagePath(app), true);
        db.query("UPDATE apps SET content_path = ?, manifest_json = '{}' WHERE id = ?").run(
          path,
          app.id,
        );
        counts.apps++;
      }
      for (const row of db
        .query<
          {
            window_id: string;
            app_id: string;
            html_snapshot: string;
            snapshot_path: string | null;
            title: string;
            w: number;
            h: number;
            opened_at: number;
            updated_at: number;
            content_path: string;
          },
          []
        >(
          "SELECT m.*, w.title, w.w, w.h, w.opened_at, a.content_path FROM app_memory m JOIN windows w ON w.id = m.window_id JOIN apps a ON a.id = m.app_id",
        )
        .all()) {
        const path =
          row.snapshot_path ??
          snapshotFile(
            { id: row.window_id, title: row.title, app_id: row.app_id },
            row.content_path,
          );
        if (!row.snapshot_path) writeContent(path, row.html_snapshot, true);
        if (row.app_id === "__transient__") {
          writeContent(
            `${dirname(path)}/app.json`,
            JSON.stringify(
              {
                id: row.window_id,
                name: row.title,
                kind: "virtual",
                sourceWindowId: row.window_id,
                isInstalled: false,
                manifest: { defaultSize: { w: row.w, h: row.h } },
                entry: "index.html",
              },
              null,
              2,
            ),
            true,
          );
        }
        db.query(
          "UPDATE app_memory SET snapshot_path = ?, html_snapshot = '' WHERE window_id = ?",
        ).run(path, row.window_id);
        counts.snapshots++;
      }
      for (const row of db
        .query<{ id: string; mime: string; bytes: Uint8Array; content_path: string | null }, []>(
          "SELECT id, mime, bytes, content_path FROM images",
        )
        .iterate()) {
        const path = row.content_path ?? imageFile(row.id, row.mime);
        if (!row.content_path) {
          writeContent(path, row.bytes, true);
          if (!readFileSync(diskPath(path)).equals(Buffer.from(row.bytes)))
            throw new Error(`Image migration verification failed: ${row.id}`);
        }
        db.query("UPDATE images SET content_path = ?, bytes = X'' WHERE id = ?").run(path, row.id);
        counts.images++;
      }
      counts.files = db
        .query<{ n: number }, []>("SELECT count(*) n FROM vfs_nodes WHERE type != 'shortcut'")
        .get()!.n;
      db.query("UPDATE vfs_nodes SET content = NULL WHERE type != 'shortcut'").run();
      const remaining = db
        .query<{ n: number }, []>(
          "SELECT (SELECT count(*) FROM apps WHERE content_path IS NULL) + (SELECT count(*) FROM app_memory WHERE snapshot_path IS NULL) + (SELECT count(*) FROM images WHERE content_path IS NULL) AS n",
        )
        .get()!.n;
      if (remaining)
        throw new Error(`System-disk migration left ${remaining} content records without files`);
      writeContent(
        "System/storage.json",
        JSON.stringify({ version: 1, migratedAt: Date.now(), counts }, null, 2),
      );
      db.query(
        "INSERT INTO storage_version (version, backup_path, completed_at) VALUES (1, ?, ?)",
      ).run(backup ?? null, Date.now());
    })();
    console.log(`[storage] system disk v1 ready: ${JSON.stringify(counts)}`);
  });
}

/** v2 materializes the shortcut records deliberately excluded by v1. */
export async function migrateSystemDisk(backup?: string): Promise<void> {
  await migrateDiskContent(backup);
  await enqueue(() => {
    const db = getDb();
    if (hasSystemDiskVersion(db, 2)) return;
    materializeLegacyFiles(true);
    const shortcuts = db
      .query<{ target_app_id: string; meta_json: string }, []>(
        "SELECT target_app_id, meta_json FROM vfs_nodes WHERE type = 'shortcut'",
      )
      .all();
    for (const row of shortcuts) {
      const meta = JSON.parse(row.meta_json);
      const path = meta.diskTrashId ? `Trash/${meta.diskTrashId}/item` : meta.diskPath;
      if (
        typeof path !== "string" ||
        readShortcut(diskPath(path, true)).appId !== row.target_app_id
      )
        throw new Error("Shortcut migration verification failed");
    }
    const storage = JSON.parse(readFileSync(diskPath("System/storage.json"), "utf8"));
    writeContent(
      "System/storage.json",
      JSON.stringify(
        { ...storage, version: 2, shortcuts: shortcuts.length, shortcutsMigratedAt: Date.now() },
        null,
        2,
      ),
    );
    db.query("INSERT INTO storage_version (version,backup_path,completed_at) VALUES (2,?,?)").run(
      backup ?? null,
      Date.now(),
    );
    console.log(`[storage] system disk v2 ready: ${shortcuts.length} shortcuts migrated`);
  });
  const pending = join(env.runtimeDir, "system-disk-migration.json");
  if (existsSync(pending)) unlinkSync(pending);
}
