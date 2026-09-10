export const SYSTEM_FOLDERS = [
  "System",
  "Desktop",
  "Documents",
  "Medias",
  "Applications",
  "Trash",
  "Cache",
] as const;

/** Paths are relative to the VibeOS system disk, never host filesystem paths. */
export interface DiskEntry {
  path: string;
  name: string;
  kind: "file" | "directory" | "symlink" | "shortcut" | "application";
  targetAppId?: string;
  icon?: string;
  size: number;
  modifiedAt: number;
  originalPath?: string;
}

// Whole-file WebSocket uploads are bounded; downloads stream directly from disk.
export const FILE_UPLOAD_LIMIT = 16 * 1024 * 1024;
export const FILE_TEXT_LIMIT = 2 * 1024 * 1024;

/** Address-bar paths use the system disk root; ./ and ../ resolve from the current folder. */
export function resolveDiskAddress(address: string, current: string): string {
  const value = address.trim();
  const relative =
    value === "." || value === ".." || value.startsWith("./") || value.startsWith("../");
  const parts: string[] = [];
  for (const part of `${relative ? `${current}/` : ""}${value}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("path");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** Only passive browser media can be served inline. HTML/SVG remain plain text. */
export function fileMediaType(path: string): string | undefined {
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    opus: "audio/ogg",
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    ogv: "video/ogg",
  };
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension && Object.hasOwn(types, extension) ? types[extension] : undefined;
}

export type FileRequestCommand =
  | DiskCommand
  | { action: "open"; path: string }
  | { action: "reveal"; path: string };

export type DiskCommand =
  | { action: "list" | "stat" | "read" | "mkdir" | "trash" | "restore" | "delete"; path: string }
  | { action: "move" | "copy"; path: string; destination: string }
  | {
      action: "write";
      path: string;
      content: string;
      encoding?: "base64";
      /** Required to replace an existing file; detects edits from another window/program. */
      version?: string;
    };

export interface DiskResult {
  windowId?: string;
  path?: string;
  entries?: DiskEntry[];
  entry?: DiskEntry;
  content?: string;
  version?: string;
  error?: string;
}
