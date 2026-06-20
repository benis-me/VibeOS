import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export function migrate(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);");
  const row = db.query<{ version: number }, []>("SELECT version FROM schema_version LIMIT 1").get();
  const current = row?.version ?? 0;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let applied = current;
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (!Number.isFinite(version) || version <= current) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
    })();
    applied = version;
    console.log(`[migrate] applied ${file}`);
  }

  if (applied !== current) {
    db.exec("DELETE FROM schema_version;");
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(applied);
  }
}
