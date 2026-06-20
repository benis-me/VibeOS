import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

interface KernelRow {
  id: string;
  boot_count: number;
  last_boot_at: number | null;
  global_state_json: string;
  updated_at: number;
}

export interface KernelState {
  bootCount: number;
  lastBootAt: number | null;
  globalState: Record<string, unknown>;
}

const KERNEL_ID = "kernel";

export function loadKernel(): KernelState {
  const db = getDb();
  const row = db
    .query<KernelRow, [string]>("SELECT * FROM kernel_state WHERE id = ?")
    .get(KERNEL_ID);
  if (!row) {
    return { bootCount: 0, lastBootAt: null, globalState: {} };
  }
  return {
    bootCount: row.boot_count,
    lastBootAt: row.last_boot_at,
    globalState: safeJson(row.global_state_json),
  };
}

export function recordBoot(): Promise<KernelState> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const existing = loadKernel();
    const next: KernelState = {
      bootCount: existing.bootCount + 1,
      lastBootAt: now,
      globalState: existing.globalState,
    };
    db.query(
      `INSERT INTO kernel_state (id, boot_count, last_boot_at, global_state_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET boot_count = excluded.boot_count,
         last_boot_at = excluded.last_boot_at, updated_at = excluded.updated_at`,
    ).run(KERNEL_ID, next.bootCount, now, JSON.stringify(next.globalState), now);
    return next;
  });
}

export function saveGlobalState(globalState: Record<string, unknown>): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    db.query(`UPDATE kernel_state SET global_state_json = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(globalState),
      now,
      KERNEL_ID,
    );
  });
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
