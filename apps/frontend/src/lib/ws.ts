import {
  makeEnvelope,
  type ClientToServer,
  type ServerToClient,
  type ServerToClientType,
  type WsEnvelope,
} from "@vibeos/shared/protocol";
import { ulid } from "@vibeos/shared/util";

type Handler<T extends ServerToClientType> = (
  payload: Extract<ServerToClient, { type: T }>["payload"],
) => void;

type AnyHandler = (payload: unknown) => void;

const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<AnyHandler>>();
  private statusHandlers = new Set<(connected: boolean) => void>();
  private queue: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.notifyStatus(true);
      for (const frame of this.queue) ws.send(frame);
      this.queue = [];
    };

    ws.onmessage = (e) => {
      let env: WsEnvelope<unknown>;
      try {
        env = JSON.parse(e.data as string) as WsEnvelope<unknown>;
      } catch {
        return;
      }
      const set = this.handlers.get(env.type);
      if (set) for (const h of set) h(env.payload);
    };

    ws.onclose = () => {
      this.notifyStatus(false);
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 800);
  }

  private notifyStatus(connected: boolean): void {
    for (const h of this.statusHandlers) h(connected);
  }

  onStatus(fn: (connected: boolean) => void): () => void {
    this.statusHandlers.add(fn);
    return () => this.statusHandlers.delete(fn);
  }

  on<T extends ServerToClientType>(type: T, fn: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as AnyHandler);
    return () => set?.delete(fn as AnyHandler);
  }

  send<T extends ClientToServer["type"]>(
    type: T,
    payload: Extract<ClientToServer, { type: T }>["payload"],
  ): void {
    const env = makeEnvelope(type, payload, ulid());
    const frame = JSON.stringify(env);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
    } else {
      this.queue.push(frame);
    }
  }
}

export const wsClient = new WsClient();
