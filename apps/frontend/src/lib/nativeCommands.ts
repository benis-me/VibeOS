import type { ApplicationCommand, MemoryCommand } from "@vibeos/shared";
import { ulid } from "@vibeos/shared/util";
import { wsClient } from "./ws";

function request(kind: "application" | "memory", command: ApplicationCommand | MemoryCommand) {
  return new Promise<{ appId?: string; path?: string }>((resolve, reject) => {
    const requestId = ulid();
    const finish = (error?: string, result: { appId?: string; path?: string } = {}) => {
      clearTimeout(timer);
      off();
      disconnect();
      if (error) reject(new Error(error));
      else resolve(result);
    };
    const off = wsClient.on(
      kind === "application" ? "s2c.application.result" : "s2c.memory.result",
      (p) => {
        if (p.requestId === requestId) finish(p.error, "appId" in p ? p : {});
      },
    );
    const disconnect = wsClient.onStatus((connected) => {
      if (!connected) finish("error.disconnected");
    });
    const timer = setTimeout(() => finish("error.timeout"), 20000);
    const sent =
      kind === "application"
        ? wsClient.send("c2s.application.command", {
            requestId,
            command: command as ApplicationCommand,
          })
        : wsClient.send("c2s.memory.command", { requestId, command: command as MemoryCommand });
    if (!sent) finish("error.disconnected");
  });
}
export const requestApplication = (command: ApplicationCommand) => request("application", command);
export const requestMemory = (command: MemoryCommand) => request("memory", command);
