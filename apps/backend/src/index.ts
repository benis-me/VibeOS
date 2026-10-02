import { boot } from "./kernel/boot.ts";
import { installShutdown } from "./kernel/shutdown.ts";
import { startAgents } from "./agents/AgentScheduler.ts";
import { bus } from "./events/bus.ts";
import { env } from "./config/env.ts";

const { server, interrupted } = await boot();
installShutdown(server);

if (!env.agentsDisabled) {
  startAgents();
  // Finish the first paints the last shutdown cut off.
  for (const windowId of interrupted) bus.emit("window.firstRender", { windowId });
}
