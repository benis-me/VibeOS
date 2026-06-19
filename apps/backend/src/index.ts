import { boot } from "./kernel/boot.ts";
import { installShutdown } from "./kernel/shutdown.ts";
import { startAgents } from "./agents/AgentScheduler.ts";
import { env } from "./config/env.ts";

const { server } = await boot();
installShutdown(server);

if (!env.agentsDisabled) {
  startAgents();
}
