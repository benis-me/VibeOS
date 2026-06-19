import type {
  Notification,
  NotificationKind,
  NotificationSource,
  NotificationAction,
} from "@vibeos/shared/domain";
import { ulid, stripEmoji } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

interface NotifRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  app_id: string | null;
  source: string;
  read: number;
  action_json: string | null;
  created_at: number;
}

function toNotif(row: NotifRow): Notification {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body ?? undefined,
    appId: row.app_id ?? undefined,
    source: row.source as NotificationSource,
    read: row.read === 1,
    action: row.action_json ? (safeJson(row.action_json) as NotificationAction) : undefined,
    createdAt: row.created_at,
  };
}

export function listRecent(limit = 50): Notification[] {
  const db = getDb();
  return db
    .query<NotifRow, [number]>("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?")
    .all(limit)
    .map(toNotif);
}

export function get(id: string): Notification | null {
  const db = getDb();
  const row = db.query<NotifRow, [string]>("SELECT * FROM notifications WHERE id = ?").get(id);
  return row ? toNotif(row) : null;
}

export function create(input: {
  kind: NotificationKind;
  title: string;
  body?: string;
  appId?: string;
  source: NotificationSource;
  action?: NotificationAction;
}): Promise<Notification> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const id = ulid(now);
    const title = stripEmoji(input.title);
    const body = input.body ? stripEmoji(input.body) : undefined;
    db.query(
      `INSERT INTO notifications (id, kind, title, body, app_id, source, read, action_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      id,
      input.kind,
      title,
      body ?? null,
      input.appId ?? null,
      input.source,
      input.action ? JSON.stringify(input.action) : null,
      now,
    );
    return {
      id,
      kind: input.kind,
      title,
      body,
      appId: input.appId,
      source: input.source,
      read: false,
      action: input.action,
      createdAt: now,
    };
  });
}

export function markRead(id: string | "all"): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    if (id === "all") {
      db.query("UPDATE notifications SET read = 1 WHERE read = 0").run();
    } else {
      db.query("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
    }
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
