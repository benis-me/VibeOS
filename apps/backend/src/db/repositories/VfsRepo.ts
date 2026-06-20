import type { VfsNode, VfsNodeType, VfsLocation } from "@vibeos/shared/domain";
import { ulid } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

interface VfsRow {
  id: string;
  parent_id: string | null;
  name: string;
  type: string;
  mime: string | null;
  content: string | null;
  target_app_id: string | null;
  location: string;
  x: number | null;
  y: number | null;
  deleted_at: number | null;
  meta_json: string;
  created_at: number;
  updated_at: number;
}

function toNode(row: VfsRow): VfsNode {
  return {
    id: row.id,
    parentId: row.parent_id ?? undefined,
    name: row.name,
    type: row.type as VfsNodeType,
    mime: row.mime ?? undefined,
    content: row.content ?? undefined,
    targetAppId: row.target_app_id ?? undefined,
    location: row.location as VfsLocation,
    x: row.x ?? undefined,
    y: row.y ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    meta: safeJson(row.meta_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listByLocation(location: VfsLocation): VfsNode[] {
  const db = getDb();
  return db
    .query<VfsRow, [string]>("SELECT * FROM vfs_nodes WHERE location = ? ORDER BY created_at")
    .all(location)
    .map(toNode);
}

export function getNode(id: string): VfsNode | null {
  const db = getDb();
  const row = db.query<VfsRow, [string]>("SELECT * FROM vfs_nodes WHERE id = ?").get(id);
  return row ? toNode(row) : null;
}

function gridSlot(): { x: number; y: number } {
  const db = getDb();
  const row = db
    .query<{ c: number }, []>("SELECT COUNT(*) as c FROM vfs_nodes WHERE location = 'desktop'")
    .get();
  const n = row?.c ?? 0;
  const col = Math.floor(n / 7);
  const rowIdx = n % 7;
  return { x: 24 + col * 96, y: 24 + rowIdx * 100 };
}

export function createNode(input: {
  name: string;
  type: VfsNodeType;
  mime?: string;
  content?: string;
  targetAppId?: string;
  location?: VfsLocation;
  meta?: Record<string, unknown>;
}): Promise<VfsNode> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const id = ulid(now);
    const location = input.location ?? "desktop";
    const slot = location === "desktop" ? gridSlot() : { x: null, y: null };
    db.query(
      `INSERT INTO vfs_nodes (id, parent_id, name, type, mime, content, target_app_id, location, x, y, deleted_at, meta_json, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.type,
      input.mime ?? null,
      input.content ?? null,
      input.targetAppId ?? null,
      location,
      slot.x,
      slot.y,
      JSON.stringify(input.meta ?? {}),
      now,
      now,
    );
    return getNode(id)!;
  });
}

export function moveNode(input: {
  nodeId: string;
  location: VfsLocation;
  x?: number;
  y?: number;
  parentId?: string;
}): Promise<VfsNode | null> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const deletedAt = input.location === "recyclebin" ? now : null;
    db.query(
      `UPDATE vfs_nodes SET location = ?, x = COALESCE(?, x), y = COALESCE(?, y),
        parent_id = ?, deleted_at = ?, updated_at = ? WHERE id = ?`,
    ).run(
      input.location,
      input.x ?? null,
      input.y ?? null,
      input.parentId ?? null,
      deletedAt,
      now,
      input.nodeId,
    );
    return getNode(input.nodeId);
  });
}

/** Permanently delete a node. Returns true if a row was removed. */
export function deleteNode(nodeId: string): Promise<boolean> {
  return enqueue(() => {
    const db = getDb();
    const r = db.query("DELETE FROM vfs_nodes WHERE id = ?").run(nodeId);
    return r.changes > 0;
  });
}

/** Permanently delete every node in the recycle bin. Returns the removed ids. */
export function emptyRecycleBin(): Promise<string[]> {
  return enqueue(() => {
    const db = getDb();
    const ids = db
      .query<{ id: string }, []>("SELECT id FROM vfs_nodes WHERE location = 'recyclebin'")
      .all()
      .map((r) => r.id);
    db.query("DELETE FROM vfs_nodes WHERE location = 'recyclebin'").run();
    return ids;
  });
}

/** Create an app shortcut on the desktop (idempotent by target app). */
export function ensureShortcut(
  appId: string,
  name: string,
  icon?: string,
): Promise<VfsNode | null> {
  return enqueue(() => {
    const db = getDb();
    const existing = db
      .query<VfsRow, [string]>(
        "SELECT * FROM vfs_nodes WHERE target_app_id = ? AND type = 'shortcut'",
      )
      .get(appId);
    if (existing) return toNode(existing);
    const now = Date.now();
    const id = ulid(now);
    const slot = gridSlot();
    db.query(
      `INSERT INTO vfs_nodes (id, parent_id, name, type, mime, content, target_app_id, location, x, y, deleted_at, meta_json, created_at, updated_at)
       VALUES (?, NULL, ?, 'shortcut', NULL, NULL, ?, 'desktop', ?, ?, NULL, ?, ?, ?)`,
    ).run(
      id,
      name,
      appId,
      slot.x,
      slot.y,
      JSON.stringify({ icon: icon ?? "app-window" }),
      now,
      now,
    );
    return getNode(id);
  });
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
