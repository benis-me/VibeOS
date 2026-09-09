import { getDb } from "../database.ts";
import { existsSync, readFileSync } from "node:fs";
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
  if (!row) return null;
  if (row.content_path && !existsSync(diskPath(row.content_path, true))) return null;
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
