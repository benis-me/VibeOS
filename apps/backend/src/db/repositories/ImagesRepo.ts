import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

interface ImageRow {
  mime: string;
  bytes: Uint8Array;
}

export function getImage(id: string): { mime: string; bytes: Uint8Array } | null {
  const db = getDb();
  const row = db
    .query<ImageRow, [string]>("SELECT mime, bytes FROM images WHERE id = ?")
    .get(id);
  return row ? { mime: row.mime, bytes: row.bytes } : null;
}

export function hasImage(id: string): boolean {
  const db = getDb();
  return !!db.query<{ id: string }, [string]>("SELECT id FROM images WHERE id = ?").get(id);
}

export function putImage(rec: {
  id: string;
  prompt: string;
  model: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<void> {
  return enqueue(() => {
    getDb()
      .query(
        "INSERT OR IGNORE INTO images (id, prompt, model, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(rec.id, rec.prompt, rec.model, rec.mime, rec.bytes, Date.now());
  });
}
