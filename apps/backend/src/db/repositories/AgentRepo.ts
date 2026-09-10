import type {
  AgentRole,
  AgentTrigger,
  AgentRunStatus,
  AgentRun,
  AgentLog,
  ActivityFilter,
  ActivityDetails,
} from "@vibeos/shared/domain";
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
  trace_id: string | null;
  window_id: string | null;
  app_id: string | null;
}

function toAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    traceId: row.trace_id ?? undefined,
    windowId: row.window_id ?? undefined,
    appId: row.app_id ?? undefined,
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
  traceId?: string;
  windowId?: string;
  appId?: string;
}): Promise<AgentRun> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const id = ulid(now);
    db.query(
      `INSERT INTO agent_runs (id, role, trigger, model, app_name, status, started_at, trace_id, window_id, app_id)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    ).run(
      id,
      input.role,
      input.trigger,
      input.model ?? null,
      input.appName ?? null,
      now,
      input.traceId ?? id,
      input.windowId ?? null,
      input.appId ?? null,
    );
    return {
      id,
      traceId: input.traceId ?? id,
      windowId: input.windowId,
      appId: input.appId,
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

/** Keep provider usage; validation/execution can fail after the model returned successfully. */
export function setOutcome(id: string, status: "error" | "aborted", error?: string) {
  return enqueue(() => {
    const changed = getDb()
      .query("UPDATE agent_runs SET status=?, error=?, ended_at=? WHERE id=? AND status='ok'")
      .run(status, error ?? null, Date.now(), id).changes;
    return changed ? getRun(id) : null;
  });
}

export function log(
  runId: string | undefined,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: unknown,
  traceId?: string,
): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      "INSERT INTO agent_logs (id, run_id, level, message, data_json, ts, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      ulid(),
      runId ?? null,
      level,
      message,
      data !== undefined ? JSON.stringify(data) : null,
      Date.now(),
      traceId ?? (runId ? getRun(runId)?.traceId : null) ?? null,
    );
  });
}

/** Stable cursor also includes the id: multiple runs often start in the same millisecond. */
export function recentRuns(
  limit = 50,
  before?: number,
  filter: ActivityFilter = {},
  beforeId?: string,
): AgentRun[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (before != null) {
    where.push(beforeId ? "(started_at < ? OR (started_at = ? AND id < ?))" : "started_at < ?");
    args.push(...(beforeId ? [before, before, beforeId] : [before]));
  }
  for (const key of ["status", "role"] as const)
    if (filter[key]) {
      where.push(`${key}=?`);
      args.push(filter[key]!);
    }
  if (filter.query?.trim()) {
    where.push(
      "instr(lower(coalesce(app_name,'') || ' ' || coalesce(model,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(error,'') || ' ' || coalesce(trace_id,'') || ' ' || id), lower(?)) > 0",
    );
    args.push(filter.query.trim());
  }
  return getDb()
    .query<AgentRunRow, (string | number)[]>(
      `SELECT * FROM agent_runs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY started_at DESC, id DESC LIMIT ?`,
    )
    .all(...args, limit)
    .map(toAgentRun);
}

export function runDetails(id: string): ActivityDetails | null {
  const run = getRun(id);
  if (!run) return null;
  const related = run.traceId
    ? getDb()
        .query<AgentRunRow, [string]>(
          "SELECT * FROM agent_runs WHERE trace_id=? ORDER BY started_at, id LIMIT 501",
        )
        .all(run.traceId)
        .map(toAgentRun)
    : [run];
  const rows = getDb()
    .query<
      {
        id: string;
        run_id: string | null;
        trace_id: string | null;
        level: AgentLog["level"];
        message: string;
        data_json: string | null;
        ts: number;
      },
      [string, string]
    >("SELECT * FROM agent_logs WHERE trace_id=? OR run_id=? ORDER BY ts, rowid LIMIT 501")
    .all(run.traceId ?? id, id);
  return {
    run,
    relatedRuns: related.slice(0, 500),
    truncated: rows.length > 500 || related.length > 500,
    logs: rows.slice(0, 500).map((row) => ({
      id: row.id,
      runId: row.run_id ?? undefined,
      traceId: row.trace_id ?? undefined,
      level: row.level,
      message: row.message,
      ts: row.ts,
      data: row.data_json ? JSON.parse(row.data_json) : undefined,
    })),
  };
}

/** Prune old logs/runs to keep the DB small. */
export function prune(keep = 500): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    db.query(
      `DELETE FROM agent_runs WHERE status != 'running' AND id NOT IN (SELECT id FROM agent_runs ORDER BY started_at DESC, id DESC LIMIT ?)`,
    ).run(keep);
    db.query(
      "DELETE FROM agent_logs WHERE run_id IS NULL AND ts < ? AND trace_id NOT IN (SELECT trace_id FROM agent_runs WHERE trace_id IS NOT NULL)",
    ).run(Date.now() - 86_400_000);
  });
}
