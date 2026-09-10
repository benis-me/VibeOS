import { getDb } from "../database.ts";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { diskPath } from "../../files/disk.ts";
import { imageFile, writeContent } from "../../files/content.ts";
import { enqueue } from "./writeQueue.ts";

interface ImageRow {
  mime: string;
  bytes: Uint8Array;
  content_path: string | null;
}

export function getImage(id: string): { mime: string; bytes: Uint8Array } | null {
  const db = getDb();
  const row = db
    .query<ImageRow, [string]>("SELECT mime, bytes, content_path FROM images WHERE id = ?")
    .get(id);
  if (!row || (row.content_path && !existsSync(diskPath(row.content_path, true)))) {
    // ponytail: scan bundle indexes only on a cache miss; add an asset SQL index if large version histories make this slow.
    const versions = db
      .query<{ path: string }, []>(
        "SELECT v.path FROM app_versions v JOIN apps a ON a.id=v.app_id WHERE a.is_installed=1 ORDER BY v.created_at DESC",
      )
      .all();
    for (const version of versions) {
      try {
        const root = dirname(version.path);
        const asset = JSON.parse(readFileSync(diskPath(`${root}/assets.json`, true), "utf8"))[id];
        if (asset && typeof asset.mime === "string" && /^Assets\/[a-zA-Z0-9_.-]+$/.test(asset.file))
          return { mime: asset.mime, bytes: readFileSync(diskPath(`${root}/${asset.file}`, true)) };
      } catch {
        /* Other bundles may still hold the resource. */
      }
    }
    return null;
  }
  return {
    mime: row.mime,
    bytes: row.content_path ? readFileSync(diskPath(row.content_path, true)) : row.bytes,
  };
}

export function hasImage(id: string): boolean {
  const db = getDb();
  const row = db
    .query<{ content_path: string | null }, [string]>(
      "SELECT content_path FROM images WHERE id = ?",
    )
    .get(id);
  return !!row && (!row.content_path || existsSync(diskPath(row.content_path, true)));
}

export function putImage(rec: {
  id: string;
  prompt: string;
  model: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<void> {
  return enqueue(() => {
    if (hasImage(rec.id)) return;
    const path = imageFile(rec.id, rec.mime);
    writeContent(path, rec.bytes);
    getDb()
      .query(
        "INSERT INTO images (id, prompt, model, mime, bytes, created_at, content_path) VALUES (?, ?, ?, ?, X'', ?, ?) ON CONFLICT(id) DO UPDATE SET content_path = excluded.content_path, bytes = X''",
      )
      .run(rec.id, rec.prompt, rec.model, rec.mime, Date.now(), path);
  });
}
