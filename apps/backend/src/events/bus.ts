import { EventEmitter } from "node:events";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AppDelivery, MessageTrace } from "@vibeos/shared";
import type { ServerToClient } from "@vibeos/shared/protocol";
import type { AiOp, DragPayload, DropTarget } from "@vibeos/shared/protocol";
import type { AgentRole } from "@vibeos/shared/domain";

export interface BusEvents {
  "disk.changed": { paths: string[]; trace?: MessageTrace };
  "app.delivery": { delivery: AppDelivery };
  "app.delivery.cancel": {
    id?: string;
    subscriptionId?: string;
    windowId: string;
    abort?: boolean;
  };
  "system.broadcast": { message: ServerToClient; trace?: MessageTrace };
  /** A user operation arrived inside a window — drives UI generation. */
  "op.received": { windowId: string; op: AiOp };
  "op.dragdrop": { windowId?: string; source: DragPayload; target: DropTarget };
  /** A window was opened and needs its first AI render. */
  "window.firstRender": { windowId: string };
  /** A window spawned by the AI with a specific seed prompt for its content. */
  "window.spawnRender": { windowId: string; seedPrompt: string };
  /** A window was closed — any in-flight generation for it must be aborted. */
  "window.closed": { windowId: string };
  /** System tick from the scheduler. */
  "agent.tick": { role: AgentRole };
}

class TypedBus {
  private ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(50);
  }

  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void {
    this.ee.emit(type, payload);
  }

  on<K extends keyof BusEvents>(type: K, fn: (payload: BusEvents[K]) => void): () => void {
    this.ee.on(type, fn as (p: unknown) => void);
    return () => this.ee.off(type, fn as (p: unknown) => void);
  }
}

export const bus = new TypedBus();
export const messageContext = new AsyncLocalStorage<MessageTrace>();
