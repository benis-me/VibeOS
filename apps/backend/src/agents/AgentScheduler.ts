/**
 * Agent scheduler for the timer-driven system-event agent
 * (VIBEOS_AGENTS_DISABLED=1 turns it off; UI generation is always on).
 */
import type { TimerAgent } from "./types.ts";
import { SystemEventAgent } from "./SystemEventAgent.ts";
import { loadSettings } from "../db/repositories/SettingsRepo.ts";
import { hasClients } from "../server/wsGateway.ts";

let started = false;

export function startAgents(): void {
  if (started) return;
  started = true;

  // Ambient events are for someone watching: with no client connected, no model call.
  scheduleTimer(
    SystemEventAgent,
    () => hasClients() && loadSettings().prefs.proactiveAgents !== false,
  );

  console.log("[agents] timers started (system-event)");
}

function scheduleTimer(agent: TimerAgent, enabled: () => boolean): void {
  const loop = () => {
    const jitter = agent.intervalMs * (0.5 + Math.random());
    setTimeout(async () => {
      if (enabled()) {
        try {
          await agent.tick();
        } catch (e) {
          console.warn(`[agents] ${agent.role} tick failed:`, e instanceof Error ? e.message : e);
        }
      }
      loop();
    }, jitter);
  };
  loop();
}
