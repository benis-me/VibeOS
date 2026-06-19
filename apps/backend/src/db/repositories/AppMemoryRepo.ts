import type { AppMemory, Interaction } from "@vibeos/shared/domain";
import { ulid } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

interface MemoryRow {
  window_id: string;
  app_id: string;
  html_snapshot: string;
  episode_summary: string;
  sdk_session_id: string | null;
  updated_at: number;
}

interface InteractionRow {
  id: string;
  window_id: string;
  seq: number;
  op_kind: string;
  op_payload_json: string;
  result_summary: string | null;
  created_at: number;
}

const RECENT_LIMIT = 12;

export function getMemory(windowId: string): AppMemory | null {
  const db = getDb();
  const row = db
    .query<MemoryRow, [string]>("SELECT * FROM app_memory WHERE window_id = ?")
    .get(windowId);
  if (!row) return null;
  return {
    windowId: row.window_id,
    appId: row.app_id,
    htmlSnapshot: row.html_snapshot,
    episodeSummary: row.episode_summary,
    sdkSessionId: row.sdk_session_id ?? undefined,
    updatedAt: row.updated_at,
  };
}

export function getSnapshot(windowId: string): string {
  return getMemory(windowId)?.htmlSnapshot ?? "";
}

export function ensureMemory(windowId: string, appId: string): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      `INSERT INTO app_memory (window_id, app_id, html_snapshot, episode_summary, sdk_session_id, updated_at)
       VALUES (?, ?, '', '', NULL, ?)
       ON CONFLICT(window_id) DO NOTHING`,
    ).run(windowId, appId, Date.now());
  });
}

export function saveSnapshot(windowId: string, html: string): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      "UPDATE app_memory SET html_snapshot = ?, updated_at = ? WHERE window_id = ?",
    ).run(html, Date.now(), windowId);
  });
}

export function saveSummary(windowId: string, summary: string): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      "UPDATE app_memory SET episode_summary = ?, updated_at = ? WHERE window_id = ?",
    ).run(summary, Date.now(), windowId);
  });
}

export function saveSessionId(windowId: string, sessionId: string): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      "UPDATE app_memory SET sdk_session_id = ?, updated_at = ? WHERE window_id = ?",
    ).run(sessionId, Date.now(), windowId);
  });
}

export function recentInteractions(windowId: string): Interaction[] {
  const db = getDb();
  const rows = db
    .query<InteractionRow, [string, number]>(
      "SELECT * FROM interactions WHERE window_id = ? ORDER BY seq DESC LIMIT ?",
    )
    .all(windowId, RECENT_LIMIT);
  return rows.reverse().map((r) => ({
    id: r.id,
    windowId: r.window_id,
    seq: r.seq,
    opKind: r.op_kind,
    opPayload: safeJson(r.op_payload_json),
    resultSummary: r.result_summary ?? undefined,
    createdAt: r.created_at,
  }));
}

export function addInteraction(input: {
  windowId: string;
  opKind: string;
  opPayload: unknown;
  resultSummary?: string;
}): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const seqRow = db
      .query<{ maxseq: number | null }, [string]>(
        "SELECT MAX(seq) as maxseq FROM interactions WHERE window_id = ?",
      )
      .get(input.windowId);
    const seq = (seqRow?.maxseq ?? 0) + 1;
    db.query(
      `INSERT INTO interactions (id, window_id, seq, op_kind, op_payload_json, result_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ulid(now),
      input.windowId,
      seq,
      input.opKind,
      JSON.stringify(input.opPayload),
      input.resultSummary ?? null,
      now,
    );
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
