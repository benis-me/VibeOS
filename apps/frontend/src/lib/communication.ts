import {
  communicationCommandSchema,
  MESSAGE_TIMEOUT,
  type CommunicationCommand,
  type AppDelivery,
  type MessageData,
} from "@vibeos/shared";
import { ulid } from "@vibeos/shared/util";
import { wsClient } from "./ws";
import { useConnectionStore } from "@/stores/connectionStore";

/** Native apps and declarative HTML controls use exactly the same request path. */
export function sendCommunication(
  windowId: string,
  input: CommunicationCommand,
): Promise<MessageData> {
  const command = communicationCommandSchema.parse(input);
  if (!useConnectionStore.getState().connected)
    return Promise.reject(new Error("communication.disconnected"));
  return new Promise((resolve, reject) => {
    const requestId = ulid();
    const finish = (data: MessageData, error?: string) => {
      clearTimeout(timer);
      offResult();
      offDelivery();
      offStatus();
      offClose();
      if (error) reject(new Error(error));
      else resolve(data);
    };
    const offResult = wsClient.on("s2c.communication.result", (p) => {
      if (
        p.requestId === requestId &&
        p.windowId === windowId &&
        (p.error || command.action !== "request")
      )
        finish(null, p.error);
    });
    const offDelivery = wsClient.on("s2c.communication.delivery", ({ delivery }) => {
      if (
        delivery.windowId === windowId &&
        delivery.kind === "response" &&
        delivery.correlationId === requestId
      )
        finish(delivery.data, delivery.error);
    });
    const offStatus = wsClient.onStatus((connected) => {
      if (!connected) finish(null, "communication.disconnected");
    });
    const offClose = wsClient.on("s2c.window.closed", (p) => {
      if (p.windowId === windowId) finish(null, "communication.closed");
    });
    const timer = setTimeout(
      () => finish(null, "communication.timeout"),
      (command.action === "request" || command.action === "send"
        ? (command.timeoutMs ?? MESSAGE_TIMEOUT)
        : MESSAGE_TIMEOUT) + 1000,
    );
    if (!wsClient.send("c2s.communication.command", { windowId, requestId, command }))
      finish(null, "communication.disconnected");
  });
}

/** Bind only literal text. No selectors, HTML interpolation or executable expressions. */
export function bindCommunication(
  root: HTMLElement,
  delivery: AppDelivery,
  translate: (key: string) => string,
) {
  if (!delivery.channel || delivery.mode !== "data") return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-vibeos-bind]")) {
    const binding = el.dataset.vibeosBind ?? "";
    if (
      (binding !== delivery.channel && !binding.startsWith(delivery.channel + ".")) ||
      el.matches("input,textarea,select,script,style")
    )
      continue;
    const keys =
      binding === delivery.channel ? [] : binding.slice(delivery.channel.length + 1).split(".");
    let value: unknown = delivery.data;
    if (keys[0] === "$error") value = delivery.error ? translate(delivery.error) : "";
    else
      for (const key of keys) {
        value =
          value &&
          typeof value === "object" &&
          !["__proto__", "prototype", "constructor"].includes(key) &&
          Object.hasOwn(value, key)
            ? (value as Record<string, unknown>)[key]
            : undefined;
      }
    el.textContent =
      value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
}
