import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { env } from "../config/env.ts";
import { migrateLegacyData } from "./legacyData.ts";

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  if (env.legacyDbPaths.length) {
    migrateLegacyData(env.dbPath, env.legacyDbPaths);
    mkdirSync(env.diskDir, { recursive: true, mode: 0o700 });
  }
  mkdirSync(dirname(env.dbPath), { recursive: true, mode: 0o700 });
  db = new Database(env.dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
