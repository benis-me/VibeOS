export const PROTOCOL_VERSION = 1 as const;

export interface WsEnvelope<T = unknown> {
  v: typeof PROTOCOL_VERSION;
  /** Unique message id (ulid). */
  id: string;
  /** Epoch millis. */
  ts: number;
  /** Namespaced type, e.g. "c2s.op" / "s2c.ui.patch". */
  type: string;
  payload: T;
}

export function makeEnvelope<T>(
  type: string,
  payload: T,
  id: string,
): WsEnvelope<T> {
  return { v: PROTOCOL_VERSION, id, ts: Date.now(), type, payload };
}
