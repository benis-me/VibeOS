import type { Server, ServerWebSocket } from "bun";
import { ulid } from "@vibeos/shared/util";
import { env } from "../config/env.ts";
import { registerSocket, unregisterSocket, type WsData } from "./wsGateway.ts";
import { handleMessage } from "./router.ts";

export function startHttpServer(): Server<WsData> {
  const server = Bun.serve<WsData>({
    port: env.port,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const ok = srv.upgrade(req, { data: { clientId: ulid() } });
        if (ok) return undefined;
        return new Response("ws upgrade failed", { status: 400 });
      }
      if (url.pathname === "/healthz") {
        return new Response("ok", { status: 200 });
      }
      return new Response("VibeOS backend", { status: 200 });
    },
    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        registerSocket(ws);
      },
      async message(ws: ServerWebSocket<WsData>, message) {
        await handleMessage(ws, typeof message === "string" ? message : message.toString());
      },
      close(ws: ServerWebSocket<WsData>) {
        unregisterSocket(ws);
      },
    },
  });
  console.log(`[http] VibeOS backend listening on http://localhost:${env.port}`);
  return server;
}
