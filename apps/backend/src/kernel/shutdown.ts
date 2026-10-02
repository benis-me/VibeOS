import type { Server } from "bun";
import { closeDb } from "../db/database.ts";
import { enqueue } from "../db/repositories/writeQueue.ts";
import type { WsData } from "../server/wsGateway.ts";

export function installShutdown(server: Server<WsData>): void {
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    console.log("\n[shutdown] draining…");
    server.stop(true);
    // Let queued writes land before the database closes (bounded, never hangs).
    await Promise.race([enqueue(() => {}), Bun.sleep(2000)]);
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
