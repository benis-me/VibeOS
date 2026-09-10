import { syncApplicationInstallation } from "./ApplicationRepo.ts";
import type { VfsNode, VfsNodeType, VfsLocation } from "@vibeos/shared/domain";
import { ulid } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { DiskCommand, DiskResult } from "@vibeos/shared/domain";
import { diskPath, executeDisk } from "../../files/disk.ts";

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
    materializeFile(id);
    if (location === "recyclebin") {
      const path = getNode(id)?.meta.diskPath;
      if (typeof path === "string") applyDiskMutation({ action: "trash", path });
    }
    db.query("UPDATE vfs_nodes SET content = NULL WHERE id = ? AND type != 'shortcut'").run(id);
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
    const current = getNode(input.nodeId);
    if (current?.meta.diskPath) {
      if (input.location === "recyclebin" && current.location !== "recyclebin") {
        if (existsSync(diskPath(String(current.meta.diskPath)))) {
          applyDiskMutation({ action: "trash", path: String(current.meta.diskPath) });
        }
      } else if (current.meta.diskTrashId && input.location !== "recyclebin") {
        applyDiskMutation({ action: "restore", path: String(current.meta.diskTrashId) });
      }
    }
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
    const node = getNode(nodeId);
    if (node?.meta.diskTrashId) {
      applyDiskMutation({ action: "delete", path: String(node.meta.diskTrashId) });
      return true;
    }
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
    for (const id of ids) {
      const node = getNode(id);
      if (node?.meta.diskTrashId)
        applyDiskMutation({ action: "delete", path: String(node.meta.diskTrashId) });
    }
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
    reconcileDesktop();
    const existing = db
      .query<VfsRow, [string]>(
        "SELECT * FROM vfs_nodes WHERE target_app_id = ? AND type = 'shortcut' AND location = 'desktop'",
      )
      .get(appId);
    if (existing) {
      materializeFile(existing.id);
      return getNode(existing.id);
    }
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
    materializeFile(id);
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

/** Export legacy payloads before StorageRepo clears them; the original DB is backed up. */
function materializeFile(id: string, ancestors = new Set<string>()): string | undefined {
  const node = getNode(id);
  if (!node) return;
  if (typeof node.meta.diskPath === "string") return node.meta.diskPath;
  if (ancestors.has(id)) throw new Error(`Cyclic legacy folder: ${id}`);
  ancestors.add(id);
  const parent =
    (node.parentId && materializeFile(node.parentId, ancestors)) ||
    (node.location === "desktop" || node.location === "recyclebin" ? "Desktop" : "Documents");
  mkdirSync(diskPath(parent), { recursive: true, mode: 0o700 });
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Preserve old names while removing invalid path characters.
  const cleanName = node.name.replace(/[/\\\x00-\x1f]/g, "_").replace(/^\.+$/, "_") || id;
  const name = node.type === "shortcut" ? `${cleanName}.vibelink` : cleanName;
  const content =
    node.type === "shortcut"
      ? JSON.stringify(
          { vibelink: 1, id: node.id, appId: node.targetAppId, icon: node.meta.icon },
          null,
          2,
        )
      : (node.content ?? "");
  let path = `${parent}/${name}`;
  const matches = (target: string) => {
    if (!existsSync(diskPath(target))) return false;
    const stat = lstatSync(diskPath(target));
    return node.type === "folder"
      ? stat.isDirectory()
      : stat.isFile() && readFileSync(diskPath(target), "utf8") === content;
  };
  if (existsSync(diskPath(path)) && !matches(path))
    path =
      node.type === "shortcut"
        ? `${parent}/${cleanName}.${id}.vibelink`
        : `${parent}/${name}.${id}`;
  if (!existsSync(diskPath(path))) {
    if (node.type === "folder") mkdirSync(diskPath(path), { mode: 0o700 });
    else writeFileSync(diskPath(path), content, { flag: "wx", mode: 0o600 });
  } else if (!matches(path))
    throw new Error(`Legacy file conflicts with existing disk content: ${path}`);
  const meta = { ...node.meta, diskPath: path };
  getDb().query("UPDATE vfs_nodes SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), id);
  return path;
}

export function materializeLegacyFiles(shortcuts = false): void {
  const nodes = getDb()
    .query<VfsRow, []>(
      shortcuts
        ? "SELECT * FROM vfs_nodes WHERE type = 'shortcut'"
        : "SELECT * FROM vfs_nodes WHERE type != 'shortcut'",
    )
    .all()
    .map(toNode);
  for (const node of nodes) materializeFile(node.id);
  const trashed = executeDisk({ action: "list", path: "Trash" }).entries ?? [];
  for (const node of nodes) {
    const current = getNode(node.id)!;
    if (
      current.location !== "recyclebin" ||
      current.meta.diskTrashId ||
      typeof current.meta.diskPath !== "string"
    )
      continue;
    const path = current.meta.diskPath;
    const previous = trashed.find((entry) => entry.originalPath === path);
    if (previous) applyDiskMutation({ action: "trash", path }, { path: previous.path });
    else if (existsSync(diskPath(path))) applyDiskMutation({ action: "trash", path });
    if (node.deletedAt !== undefined)
      getDb()
        .query("UPDATE vfs_nodes SET deleted_at = ? WHERE id = ?")
        .run(node.deletedAt, node.id);
  }
}

export function migrateVirtualFiles(): Promise<void> {
  return enqueue(() => materializeLegacyFiles());
}

function applyDiskMutation(
  command: DiskCommand,
  recovered?: DiskResult,
): {
  result: DiskResult;
  nodes: VfsNode[];
  removed: string[];
} {
  const result = recovered ?? executeDisk(command);
  const nodes: VfsNode[] = [];
  const removed: string[] = [];
  if (!["move", "trash", "restore", "delete"].includes(command.action))
    return { result, nodes, removed };
  const db = getDb();
  // The runtime indexes must follow the real content when Files moves or trashes it.
  if (command.action !== "delete") {
    const from = command.action === "restore" ? `Trash/${command.path}/item` : command.path;
    const to =
      command.action === "move"
        ? command.destination
        : command.action === "trash"
          ? `Trash/${result.path}/item`
          : result.path!;
    for (const [table, column] of [
      ["apps", "content_path"],
      ["app_versions", "path"],
      ["app_memory", "snapshot_path"],
      ["images", "content_path"],
      ["windows", "file_path"],
    ] as const) {
      for (const record of db
        .query<{ path: string }, []>(
          `SELECT ${column} AS path FROM ${table} WHERE ${column} IS NOT NULL`,
        )
        .all()) {
        if (record.path === from || record.path.startsWith(`${from}/`)) {
          db.query(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(
            to + record.path.slice(from.length),
            record.path,
          );
          if (table === "windows" && command.action === "move") {
            const path = to + record.path.slice(from.length);
            db.query("UPDATE windows SET title = ? WHERE file_path = ?").run(basename(path), path);
          }
        }
      }
    }
  }
  for (const row of db.query<VfsRow, []>("SELECT * FROM vfs_nodes").all()) {
    const node = toNode(row);
    const path = node.meta.diskPath;
    if (typeof path !== "string") continue;
    const inTree = path === command.path || path.startsWith(`${command.path}/`);
    if (
      (command.action === "move" || command.action === "trash") &&
      (!inTree || node.meta.diskTrashId)
    )
      continue;
    if (
      (command.action === "restore" || command.action === "delete") &&
      node.meta.diskTrashId !== command.path
    )
      continue;
    if (command.action === "delete") {
      db.query("DELETE FROM vfs_nodes WHERE id = ?").run(node.id);
      removed.push(node.id);
      continue;
    }
    if (command.action === "move") {
      node.meta.diskPath = command.destination + path.slice(command.path.length);
      node.name = basename(String(node.meta.diskPath));
      if (node.type === "shortcut") node.name = node.name.replace(/\.vibelink$/i, "");
      node.location = dirname(String(node.meta.diskPath)) === "Desktop" ? "desktop" : "folder";
    } else if (command.action === "trash") {
      node.meta.diskTrashId = result.path;
      node.meta.diskPreviousLocation = node.location;
      node.location = "recyclebin";
    } else if (command.action === "restore") {
      node.location = node.meta.diskPreviousLocation === "folder" ? "folder" : "desktop";
      delete node.meta.diskTrashId;
      delete node.meta.diskPreviousLocation;
    }
    db.query(
      "UPDATE vfs_nodes SET name = ?, meta_json = ?, location = ?, deleted_at = ?, updated_at = ? WHERE id = ?",
    ).run(
      node.name,
      JSON.stringify(node.meta),
      node.location,
      node.location === "recyclebin" ? Date.now() : null,
      Date.now(),
      node.id,
    );
    nodes.push(getNode(node.id)!);
  }
  const appIds = syncApplicationInstallation(command, result);
  if (appIds.length && (command.action === "trash" || command.action === "restore")) {
    for (const row of getDb()
      .query<VfsRow, []>("SELECT * FROM vfs_nodes WHERE type='shortcut'")
      .all()) {
      const node = toNode(row);
      if (!node.targetAppId || !appIds.includes(node.targetAppId)) continue;
      const path = node.meta.diskPath;
      if (typeof path !== "string") continue;
      if (command.action === "trash" && !node.meta.diskTrashId && existsSync(diskPath(path))) {
        const moved = applyDiskMutation({ action: "trash", path });
        const updated = getNode(node.id)!;
        updated.meta.appBundleTrashId = result.path;
        getDb()
          .query("UPDATE vfs_nodes SET meta_json=? WHERE id=?")
          .run(JSON.stringify(updated.meta), node.id);
        nodes.push(updated);
        removed.push(...moved.removed);
      } else if (
        command.action === "restore" &&
        node.meta.appBundleTrashId === command.path &&
        typeof node.meta.diskTrashId === "string" &&
        !existsSync(diskPath(path))
      ) {
        const restored = applyDiskMutation({ action: "restore", path: node.meta.diskTrashId });
        const updated = getNode(node.id)!;
        delete updated.meta.appBundleTrashId;
        getDb()
          .query("UPDATE vfs_nodes SET meta_json=? WHERE id=?")
          .run(JSON.stringify(updated.meta), node.id);
        nodes.push(updated);
        removed.push(...restored.removed);
      }
    }
  }
  return { result, nodes, removed };
}

/** Keep desktop references in sync when Files renames, moves or trashes real content. */
export function mutateDisk(command: DiskCommand, beforeWrite = () => {}) {
  return enqueue(() => {
    beforeWrite();
    const result = applyDiskMutation(command);
    const desktop = reconcileDesktop();
    return {
      ...result,
      nodes: [...result.nodes, ...desktop.nodes],
      removed: [...result.removed, ...desktop.removed],
    };
  });
}

/** Runtime holds icon positions; the real Desktop directory determines its contents. */
function reconcileDesktop(): { nodes: VfsNode[]; removed: string[] } {
  const db = getDb();
  const nodes: VfsNode[] = [];
  const removed: string[] = [];
  if (!existsSync(diskPath("Desktop"))) return { nodes, removed };
  const entries = executeDisk({ action: "list", path: "Desktop" }).entries!;
  const indexed = new Map(
    db
      .query<VfsRow, []>("SELECT * FROM vfs_nodes WHERE location != 'recyclebin'")
      .all()
      .map(toNode)
      .filter((node) => typeof node.meta.diskPath === "string")
      .map((node) => [node.meta.diskPath as string, node]),
  );
  const present = new Set(entries.map((entry) => entry.path));
  for (const [path, node] of indexed) {
    if (node.location === "desktop" && dirname(path) === "Desktop" && !present.has(path)) {
      // Preserve positions and parent references if an external file reappears.
      db.query("UPDATE vfs_nodes SET location = 'folder' WHERE id = ?").run(node.id);
      removed.push(node.id);
    }
  }
  for (const entry of entries) {
    if (entry.kind === "symlink") continue;
    const existing = indexed.get(entry.path);
    const type =
      entry.kind === "directory" ? "folder" : entry.kind === "application" ? "file" : entry.kind;
    const name = type === "shortcut" ? entry.name.replace(/\.vibelink$/i, "") : entry.name;
    if (
      existing &&
      existing.name === name &&
      existing.type === type &&
      existing.location === "desktop" &&
      existing.targetAppId === entry.targetAppId &&
      existing.meta.icon === entry.icon
    )
      continue;
    const now = Date.now();
    const id = existing?.id ?? ulid(now);
    const slot = existing ?? gridSlot();
    const meta = { ...existing?.meta, diskPath: entry.path, icon: entry.icon };
    db.query(`INSERT INTO vfs_nodes (id,name,type,target_app_id,location,x,y,meta_json,created_at,updated_at)
      VALUES (?,?,?,?,'desktop',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,type=excluded.type,target_app_id=excluded.target_app_id,location='desktop',meta_json=excluded.meta_json,updated_at=excluded.updated_at`).run(
      id,
      name,
      type,
      entry.targetAppId ?? null,
      slot.x ?? 24,
      slot.y ?? 24,
      JSON.stringify(meta),
      existing?.createdAt ?? now,
      now,
    );
    nodes.push(getNode(id)!);
  }
  return { nodes, removed };
}

export function syncDesktopFiles() {
  return enqueue(reconcileDesktop);
}
