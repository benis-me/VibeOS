import type { Server } from "bun";
import { closeDb } from "../db/database.ts";
import type { WsData } from "../server/wsGateway.ts";

export function installShutdown(server: Server<WsData>): void {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    console.log("\n[shutdown] draining…");
    server.stop(true);
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
