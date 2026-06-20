import type { Server, ServerWebSocket } from "bun";
import { ulid } from "@vibeos/shared/util";
import { env } from "../config/env.ts";
import { registerSocket, unregisterSocket, type WsData } from "./wsGateway.ts";
import { handleMessage } from "./router.ts";
import { getImageForServe } from "../ai/imageCache.ts";

export function startHttpServer(): Server<WsData> {
  const server = Bun.serve<WsData>({
    port: env.port,
    // /api/img requests block while the image generates (can take 30–150s). The
    // default idle timeout (~10s) would kill that held request → a broken image.
    // 255s is Bun's max and comfortably exceeds generation time.
    idleTimeout: 255,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const ok = srv.upgrade(req, { data: { clientId: ulid() } });
        if (ok) return undefined;
        return new Response("ws upgrade failed", { status: 400 });
      }
      if (url.pathname === "/healthz") {
        return new Response("ok", { status: 200 });
      }
      // Generated images, served by content id (awaits in-flight generation).
      if (url.pathname.startsWith("/api/img/")) {
        const img = await getImageForServe(url.pathname.slice("/api/img/".length));
        if (!img) return new Response("not found", { status: 404 });
        return new Response(img.bytes as Uint8Array<ArrayBuffer>, {
          headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=31536000, immutable" },
        });
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
