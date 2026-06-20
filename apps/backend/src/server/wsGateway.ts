import type { ServerWebSocket } from "bun";
import { makeEnvelope, type ServerToClient, type WsEnvelope } from "@vibeos/shared/protocol";
import { ulid } from "@vibeos/shared/util";

export interface WsData {
  clientId: string;
}

const sockets = new Set<ServerWebSocket<WsData>>();

export function registerSocket(ws: ServerWebSocket<WsData>): void {
  sockets.add(ws);
}

export function unregisterSocket(ws: ServerWebSocket<WsData>): void {
  sockets.delete(ws);
}

/** Send a single frame to one socket. */
export function sendTo<T extends ServerToClient["type"]>(
  ws: ServerWebSocket<WsData>,
  type: T,
  payload: Extract<ServerToClient, { type: T }>["payload"],
): void {
  const env = makeEnvelope(type, payload, ulid());
  ws.send(JSON.stringify(env));
}

/** Broadcast a frame to every connected socket. */
export function broadcast<T extends ServerToClient["type"]>(
  type: T,
  payload: Extract<ServerToClient, { type: T }>["payload"],
): void {
  if (sockets.size === 0) return;
  const env: WsEnvelope = makeEnvelope(type, payload, ulid());
  const data = JSON.stringify(env);
  for (const ws of sockets) {
    ws.send(data);
  }
}
