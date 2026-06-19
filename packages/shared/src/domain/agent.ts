import type { AgentRole } from "./settings.ts";

export type { AgentRole };

export type AgentTrigger = "timer" | "event" | "user";
export type AgentRunStatus = "running" | "ok" | "error" | "aborted";

export interface AgentRun {
  id: string;
  role: AgentRole;
  trigger: AgentTrigger;
  model?: string;
  status: AgentRunStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
  /** Which app/window this run was for (e.g. "Notes"), when applicable. */
  appName?: string;
  /** One-line summary of what the run produced. */
  summary?: string;
  /** Token usage + cost, captured from the provider when it reports them. */
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface AgentLog {
  id: string;
  runId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
  ts: number;
}
