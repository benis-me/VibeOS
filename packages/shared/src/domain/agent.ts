import type { AgentRole } from "./settings.ts";
import { z } from "zod";

export type { AgentRole };

export type AgentTrigger = "timer" | "event" | "user";
export type AgentRunStatus = "running" | "ok" | "error" | "aborted";

export interface AgentRun {
  id: string;
  traceId?: string;
  windowId?: string;
  appId?: string;
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
  runId?: string;
  traceId?: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
  ts: number;
}

export const activityFilterSchema = z.object({
  query: z.string().max(200).optional(),
  status: z.enum(["running", "ok", "error", "aborted"]).optional(),
  role: z.enum(["ui-generation", "maintenance", "system-event", "image-generation"]).optional(),
});
export type ActivityFilter = z.infer<typeof activityFilterSchema>;
export interface ActivityDetails {
  run: AgentRun;
  relatedRuns: AgentRun[];
  logs: AgentLog[];
  truncated: boolean;
}
