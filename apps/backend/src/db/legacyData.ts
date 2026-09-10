import { Database } from "bun:sqlite";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Copy an old installation once. Keep its IDs, blobs and WAL-backed data intact. */
export function migrateLegacyData(target: string, candidates: string[]): string | undefined {
  if (existsSync(target)) return;
  const sources: string[] = [];
  const unreadable: string[] = [];
  for (const path of new Set(candidates)) {
    if (path === target || !existsSync(path)) continue;
    let db: Database | undefined;
    try {
      db = new Database(path, { readonly: true });
      const tables = db
        .query<{ n: number }, []>(
          "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('settings', 'apps', 'app_memory')",
        )
        .get()!.n;
      if (tables === 3) sources.push(path);
    } catch {
      unreadable.push(path);
    } finally {
      db?.close();
    }
  }
  if (sources.length > 1) {
    throw new Error(
      `Multiple legacy VibeOS databases found: ${sources.join(", ")}. Set VIBEOS_DB_PATH to select the installation to use.`,
    );
  }
  const source = sources[0];
  if (!source) {
    if (unreadable.length)
      throw new Error(
        `Cannot read legacy VibeOS data: ${unreadable.join(", ")}. Restore it or set VIBEOS_DB_PATH explicitly; a new database was not created.`,
      );
    return;
  }

  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.migrating-${crypto.randomUUID()}`;
  const db = new Database(source, { readonly: true });
  try {
    // VACUUM INTO includes committed WAL pages, unlike copying the .db file.
    db.query("VACUUM INTO ?").run(temporary);
    const copy = new Database(temporary, { readonly: true });
    try {
      if (
        copy.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok"
      ) {
        throw new Error("Migrated VibeOS database failed its integrity check");
      }
    } finally {
      copy.close();
    }
    chmodSync(temporary, 0o600);
    try {
      // Publish the complete copy atomically; never overwrite a concurrent startup.
      linkSync(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
      throw error;
    }
    console.log(`[data] migrated ${source} → ${target}; original database retained`);
    return source;
  } finally {
    db.close();
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function hasSystemDiskVersion(db: Database, version = 1): boolean {
  return (
    !!db.query("SELECT name FROM sqlite_master WHERE name = 'storage_version'").get() &&
    !!db.query("SELECT version FROM storage_version WHERE version >= ?").get(version)
  );
}

/** Runs before SQL migrations or seeds can alter the old installation. */
export function backupBeforeStorageMigration(
  db: Database,
  paths: { dbPath: string; runtimeDir: string; diskDir: string },
  targetVersion = 2,
): string | undefined {
  if (
    hasSystemDiskVersion(db, targetVersion) ||
    !db.query("SELECT name FROM sqlite_master WHERE name = 'apps'").get()
  )
    return;
  const pending = join(
    paths.runtimeDir,
    targetVersion === 2 ? "system-disk-migration.json" : "applications-migration.json",
  );
  if (existsSync(pending)) {
    const record = JSON.parse(readFileSync(pending, "utf8"));
    if (record.source !== paths.dbPath || !existsSync(join(record.backup, "vibeos.db")))
      throw new Error("Incomplete system-disk backup; the old database has not been migrated");
    return record.backup;
  }
  const backup = join(
    paths.runtimeDir,
    "backups",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`,
  );
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  const target = join(backup, "vibeos.db");
  db.query("VACUUM INTO ?").run(target);
  chmodSync(target, 0o600);
  const copy = new Database(target, { readonly: true });
  try {
    if (copy.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok")
      throw new Error("System-disk backup failed its integrity check");
  } finally {
    copy.close();
  }
  if (existsSync(paths.diskDir))
    cpSync(paths.diskDir, join(backup, "disk"), { recursive: true, verbatimSymlinks: true });
  const cache = join(paths.runtimeDir, "cache");
  if (existsSync(cache))
    cpSync(cache, join(backup, "cache"), { recursive: true, verbatimSymlinks: true });
  const record = JSON.stringify(
    { version: targetVersion, source: paths.dbPath, backup, createdAt: Date.now() },
    null,
    2,
  );
  writeFileSync(join(backup, "backup.json"), record, { flag: "wx", mode: 0o600 });
  writeFileSync(pending, record, { flag: "wx", mode: 0o600 });
  console.log(`[storage] old data backed up to ${backup}`);
  return backup;
}
