import type { WindowState, WindowDisplayState } from "@vibeos/shared/domain";
import { ulid } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

interface WindowRow {
  id: string;
  app_id: string;
  title: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  state: string;
  is_open: number;
  focused: number;
  opened_at: number;
  updated_at: number;
}

function toWindow(row: WindowRow): WindowState {
  return {
    id: row.id,
    appId: row.app_id,
    title: row.title,
    kind: row.kind === "system" ? "system" : row.kind === "widget" ? "widget" : "app",
    rect: { x: row.x, y: row.y, w: row.w, h: row.h },
    z: row.z,
    state: row.state as WindowDisplayState,
    isOpen: row.is_open === 1,
    focused: row.focused === 1,
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
  };
}

export function listOpenWindows(): WindowState[] {
  const db = getDb();
  return db
    .query<WindowRow, []>("SELECT * FROM windows WHERE is_open = 1 ORDER BY z")
    .all()
    .map(toWindow);
}

export function getWindow(id: string): WindowState | null {
  const db = getDb();
  const row = db.query<WindowRow, [string]>("SELECT * FROM windows WHERE id = ?").get(id);
  return row ? toWindow(row) : null;
}

export function findOpenWindowByApp(appId: string): WindowState | null {
  const db = getDb();
  const row = db
    .query<WindowRow, [string]>(
      "SELECT * FROM windows WHERE app_id = ? AND is_open = 1 LIMIT 1",
    )
    .get(appId);
  return row ? toWindow(row) : null;
}

function nextZ(): number {
  const db = getDb();
  const row = db
    .query<{ maxz: number | null }, []>("SELECT MAX(z) as maxz FROM windows WHERE is_open = 1")
    .get();
  return (row?.maxz ?? 0) + 1;
}

export function openWindow(input: {
  appId: string;
  title: string;
  kind?: "app" | "system" | "widget";
  rect?: { x: number; y: number; w: number; h: number };
  /** Preferred size; position is cascaded automatically. */
  size?: { w: number; h: number };
}): Promise<WindowState> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const id = ulid(now);
    const z = nextZ();
    const w = input.size?.w ?? 760;
    const h = input.size?.h ?? 520;
    const r =
      input.rect ??
      {
        // cascade so multiple windows don't stack exactly on top of each other
        x: 70 + (z % 8) * 30,
        y: 60 + (z % 8) * 30,
        w,
        h,
      };
    db.query("UPDATE windows SET focused = 0 WHERE is_open = 1").run();
    db.query(
      `INSERT INTO windows (id, app_id, title, kind, x, y, w, h, z, state, is_open, focused, opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', 1, 1, ?, ?)`,
    ).run(id, input.appId, input.title, input.kind ?? "app", r.x, r.y, r.w, r.h, z, now, now);
    return getWindow(id)!;
  });
}

export function closeWindow(id: string): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    db.query("UPDATE windows SET is_open = 0, focused = 0, updated_at = ? WHERE id = ?").run(
      Date.now(),
      id,
    );
  });
}

export function focusWindow(id: string): Promise<WindowState | null> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const z = nextZ();
    db.query("UPDATE windows SET focused = 0 WHERE is_open = 1").run();
    db.query(
      "UPDATE windows SET focused = 1, z = ?, state = CASE WHEN state = 'minimized' THEN 'normal' ELSE state END, updated_at = ? WHERE id = ?",
    ).run(z, now, id);
    return getWindow(id);
  });
}

export function setWindowState(
  id: string,
  state: WindowDisplayState,
): Promise<WindowState | null> {
  return enqueue(() => {
    const db = getDb();
    db.query("UPDATE windows SET state = ?, updated_at = ? WHERE id = ?").run(
      state,
      Date.now(),
      id,
    );
    return getWindow(id);
  });
}

export function moveWindow(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<WindowState | null> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      "UPDATE windows SET x = ?, y = ?, w = ?, h = ?, updated_at = ? WHERE id = ?",
    ).run(rect.x, rect.y, rect.w, rect.h, Date.now(), id);
    return getWindow(id);
  });
}
