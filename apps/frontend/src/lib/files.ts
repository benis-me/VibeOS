import { FILE_UPLOAD_LIMIT, type FileRequestCommand, type DiskResult } from "@vibeos/shared";
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

export const fileBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("failed"));
    reader.readAsDataURL(file);
  });

/** A file dropped in from the host becomes a real disk file; returns its path. */
export async function importHostFile(file: File, dir = "Documents"): Promise<string> {
  if (file.size > FILE_UPLOAD_LIMIT) throw new Error("uploadSize");
  const content = await fileBase64(file);
  const dot = file.name.lastIndexOf(".");
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ext = dot > 0 ? file.name.slice(dot) : "";
  for (let n = 1; ; n++) {
    const path = `${dir}/${n === 1 ? file.name : `${stem} ${n}${ext}`}`;
    try {
      await requestFiles({ action: "write", path, content, encoding: "base64" });
      return path;
    } catch (e) {
      if ((e as Error).message !== "exists" || n >= 50) throw e;
    }
  }
}
