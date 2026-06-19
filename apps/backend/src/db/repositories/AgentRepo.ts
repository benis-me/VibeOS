import type { AgentRole, AgentTrigger, AgentRunStatus, AgentRun } from "@vibeos/shared/domain";
import { ulid } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

interface AgentRunRow {
  id: string;
  role: string;
  trigger: string;
  model: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  error: string | null;
  app_name: string | null;
  summary: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

function toAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    role: row.role as AgentRole,
    trigger: row.trigger as AgentTrigger,
    model: row.model ?? undefined,
    status: row.status as AgentRunStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    error: row.error ?? undefined,
    appName: row.app_name ?? undefined,
    summary: row.summary ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    costUsd: row.cost_usd ?? undefined,
  };
}

export function getRun(id: string): AgentRun | null {
  const db = getDb();
  const row = db.query<AgentRunRow, [string]>("SELECT * FROM agent_runs WHERE id = ?").get(id);
  return row ? toAgentRun(row) : null;
}

export function startRun(input: {
  role: AgentRole;
  trigger: AgentTrigger;
  model?: string;
  appName?: string;
}): Promise<AgentRun> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const id = ulid(now);
    db.query(
      `INSERT INTO agent_runs (id, role, trigger, model, app_name, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    ).run(id, input.role, input.trigger, input.model ?? null, input.appName ?? null, now);
    return {
      id,
      role: input.role,
      trigger: input.trigger,
      model: input.model,
      appName: input.appName,
      status: "running",
      startedAt: now,
    };
  });
}

export function setSummary(id: string, summary: string): Promise<AgentRun | null> {
  return enqueue(() => {
    const db = getDb();
    db.query("UPDATE agent_runs SET summary = ? WHERE id = ?").run(summary, id);
    return getRun(id);
  });
}

export function endRun(
  id: string,
  status: AgentRunStatus,
  error?: string,
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number },
): Promise<AgentRun | null> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      `UPDATE agent_runs SET status = ?, ended_at = ?, error = ?, input_tokens = ?, output_tokens = ?, cost_usd = ? WHERE id = ?`,
    ).run(
      status,
      Date.now(),
      error ?? null,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      usage?.costUsd ?? null,
      id,
    );
    return getRun(id);
  });
}

export function log(
  runId: string,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: unknown,
): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      "INSERT INTO agent_logs (id, run_id, level, message, data_json, ts) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      ulid(),
      runId,
      level,
      message,
      data !== undefined ? JSON.stringify(data) : null,
      Date.now(),
    );
  });
}

/** Newest runs first. `before` is a started_at cursor for scroll pagination. */
export function recentRuns(limit = 50, before?: number): AgentRun[] {
  const db = getDb();
  if (before == null) {
    return db
      .query<AgentRunRow, [number]>("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?")
      .all(limit)
      .map(toAgentRun);
  }
  return db
    .query<AgentRunRow, [number, number]>(
      "SELECT * FROM agent_runs WHERE started_at < ? ORDER BY started_at DESC LIMIT ?",
    )
    .all(before, limit)
    .map(toAgentRun);
}

/** Prune old logs/runs to keep the DB small. */
export function prune(keep = 500): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      `DELETE FROM agent_runs WHERE id NOT IN (SELECT id FROM agent_runs ORDER BY started_at DESC LIMIT ?)`,
    ).run(keep);
  });
}
