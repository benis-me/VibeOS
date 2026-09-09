import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyData } from "./legacyData.ts";

test("startup migration includes live WAL data, preserves references and never overwrites an existing installation", () => {
  const root = mkdtempSync(join(tmpdir(), "vibeos-migrate-"));
  const source = join(root, "old.db");
  const target = join(root, "runtime/vibeos.db");
  const db = new Database(source);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
    db.exec(
      "CREATE TABLE settings (id TEXT PRIMARY KEY, profile TEXT); CREATE TABLE apps (id TEXT PRIMARY KEY, manifest TEXT); CREATE TABLE app_memory (window_id TEXT PRIMARY KEY, app_id TEXT, html_snapshot TEXT); CREATE TABLE images (id TEXT PRIMARY KEY, bytes BLOB)",
    );
    db.query("INSERT INTO settings VALUES ('settings', ?)").run("保留个性化");
    db.query("INSERT INTO apps VALUES ('app-1', ?)").run('{"seedHtml":"<p>Saved app</p>"}');
    db.query("INSERT INTO app_memory VALUES ('window-1', 'app-1', ?)").run(
      '<img src="/api/img/image-1">',
    );
    db.query("INSERT INTO images VALUES ('image-1', ?)").run(new Uint8Array([1, 2, 3]));
    expect(existsSync(`${source}-wal`)).toBe(true);
    const original = readFileSync(source);
    expect(migrateLegacyData(target, [source, source])).toBe(source);
    const migrated = new Database(target);
    try {
      expect(migrated.query("SELECT * FROM settings").get()).toEqual({
        id: "settings",
        profile: "保留个性化",
      });
      expect(migrated.query("SELECT * FROM apps").all()).toEqual(
        db.query("SELECT * FROM apps").all(),
      );
      expect(migrated.query("SELECT * FROM app_memory").all()).toEqual(
        db.query("SELECT * FROM app_memory").all(),
      );
      expect(migrated.query("SELECT * FROM images").all()).toEqual(
        db.query("SELECT * FROM images").all(),
      );
      expect(readFileSync(source)).toEqual(original);
      migrated.exec("DELETE FROM app_memory");
      expect(migrateLegacyData(target, [source])).toBeUndefined();
      expect(migrated.query("SELECT * FROM app_memory").all()).toEqual([]);
    } finally {
      migrated.close();
    }
    expect(existsSync(source)).toBe(true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup migration refuses ambiguous or unreadable legacy data without creating a replacement", () => {
  const root = mkdtempSync(join(tmpdir(), "vibeos-migrate-"));
  const target = join(root, "runtime/vibeos.db");
  try {
    const candidates = [join(root, "a.db"), join(root, "b.db")];
    for (const path of candidates) {
      const db = new Database(path);
      db.exec(
        "CREATE TABLE settings (id TEXT); CREATE TABLE apps (id TEXT); CREATE TABLE app_memory (id TEXT)",
      );
      db.close();
    }
    expect(() => migrateLegacyData(target, candidates)).toThrow("Multiple legacy");
    expect(existsSync(target)).toBe(false);
    const broken = join(root, "broken.db");
    writeFileSync(broken, "not a database");
    expect(() => migrateLegacyData(target, [broken])).toThrow("Cannot read legacy");
    expect(existsSync(target)).toBe(false);
    expect(migrateLegacyData(target, [join(root, "missing.db")])).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
