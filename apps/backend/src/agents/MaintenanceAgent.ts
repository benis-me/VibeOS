import type { TimerAgent } from "./types.ts";
import { run, recordSummary } from "../ai/SdkManager.ts";
import { parseAiOutput } from "../ai/streamParser.ts";
import { listOpenWindows } from "../db/repositories/WindowRepo.ts";
import {
  getMemory,
  recentInteractions,
  consolidationCursor,
  saveConsolidation,
} from "../db/repositories/AppMemoryRepo.ts";
import { NATIVE_PRESET_APPS } from "@vibeos/shared";
import { getApp } from "../db/repositories/AppRepo.ts";
import * as AgentRepo from "../db/repositories/AgentRepo.ts";

/**
 * Background consolidation: folds each open window's recent interactions into a
 * tighter episode summary, and prunes old agent runs. Uses the fastest model.
 */
export const MaintenanceAgent: TimerAgent = {
  role: "maintenance",
  intervalMs: 300_000,

  async tick() {
    await AgentRepo.prune(500);

    for (const win of listOpenWindows()) {
      const app = getApp(win.appId);
      if (app?.presetId && NATIVE_PRESET_APPS.includes(app.presetId)) continue;
      const memory = getMemory(win.id);
      const recent = recentInteractions(win.id);
      const seq = recent.at(-1)?.seq ?? 0;
      if (recent.length < 6 || seq <= consolidationCursor(win.id)) continue;
      const prompt = `[APP]\n${app?.name ?? win.appId}\n\n[CURRENT EPISODE SUMMARY]\n${memory?.episodeSummary ?? "(none)"}\n\n[RECENT INTERACTIONS]\n${recent
        .map((r) => `- ${r.opKind} ${JSON.stringify(r.opPayload).slice(0, 120)}`)
        .join("\n")}\n\n[TASK]\nProduce an updated concise episode summary.`;

      const result = await run({
        role: "maintenance",
        trigger: "timer",
        prompt,
        appName: app?.name ?? "Maintenance",
        windowId: win.id,
        appId: win.appId,
      });
      if (!result.ok) continue;
      const parsed = parseAiOutput(result.text);
      await recordSummary(result.runId, parsed.summary || "Consolidated memory");
      if (parsed.summary) {
        await saveConsolidation(win.id, parsed.summary, seq, memory?.episodeSummary ?? "");
      }
    }
  },
};
