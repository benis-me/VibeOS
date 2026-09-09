import type { FileRequestCommand, DiskResult } from "@vibeos/shared";
import { ulid } from "@vibeos/shared/util";
import { API_BASE, wsClient } from "./ws";

export function requestFiles(command: FileRequestCommand): Promise<DiskResult> {
  return new Promise((resolve, reject) => {
    const requestId = ulid();
    const off = wsClient.on("s2c.files.result", (payload) => {
      if (payload.requestId !== requestId) return;
      clearTimeout(timer);
      off();
      if (payload.result.error) reject(new Error(payload.result.error));
      else resolve(payload.result);
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error("timeout"));
    }, 30000);
    wsClient.send("c2s.files.request", { requestId, command });
  });
}

export const fileDownloadUrl = (path: string) =>
  `${API_BASE}/api/files/download?path=${encodeURIComponent(path)}`;

export const filePreviewUrl = (path: string) =>
  `${API_BASE}/api/files/preview?path=${encodeURIComponent(path)}`;
