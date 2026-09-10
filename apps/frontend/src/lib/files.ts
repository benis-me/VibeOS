import type { FileRequestCommand, DiskResult } from "@vibeos/shared";
import { ulid } from "@vibeos/shared/util";
import { API_BASE, wsClient } from "./ws";

export function requestFiles(command: FileRequestCommand): Promise<DiskResult> {
  return new Promise((resolve, reject) => {
    const requestId = ulid();
    const finish = (error?: string, result?: DiskResult) => {
      clearTimeout(timer);
      off();
      offStatus();
      if (error) reject(new Error(error));
      else resolve(result!);
    };
    const off = wsClient.on("s2c.files.result", (payload) => {
      if (payload.requestId !== requestId) return;
      finish(payload.result.error, payload.result);
    });
    const offStatus = wsClient.onStatus((connected) => {
      if (!connected) finish("disconnected");
    });
    const timer = setTimeout(() => finish("timeout"), 30000);
    if (!wsClient.send("c2s.files.request", { requestId, command })) finish("disconnected");
  });
}

export const fileDownloadUrl = (path: string) =>
  `${API_BASE}/api/files/download?path=${encodeURIComponent(path)}`;

export const filePreviewUrl = (path: string) =>
  `${API_BASE}/api/files/preview?path=${encodeURIComponent(path)}`;
