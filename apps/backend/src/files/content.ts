import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { SYSTEM_FOLDERS, type AppDescriptor } from "@vibeos/shared/domain";
import { diskPath } from "./disk.ts";

export function ensureDiskLayout(): void {
  for (const name of SYSTEM_FOLDERS)
    mkdirSync(diskPath(name, true), { recursive: true, mode: 0o700 });
}

/** IDs keep equally named apps/windows separate; titles keep their folders recognizable. */
export function contentName(name: string, id: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Filesystem names cannot contain separators or control characters.
  const clean = (value: string) => value.replace(/[/\\\x00-\x1f]/g, "_").replace(/^\.+$/, "_");
  return `${clean(name).slice(0, 64) || "App"}--${clean(id)}`;
}

/** Publish whole files atomically. A migration may only reuse byte-identical output. */
export function writeContent(path: string, content: string | Uint8Array, migration = false): void {
  const absolute = diskPath(path, true);
  const bytes = Buffer.from(content);
  if (existsSync(absolute)) {
    if (readFileSync(absolute).equals(bytes)) return;
    if (migration) throw new Error(`Migration would overwrite existing content: ${path}`);
  }
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  const temporary = `${absolute}.vibeos-write-${randomUUID()}`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (migration) linkSync(temporary, absolute);
    else renameSync(temporary, absolute);
    if (migration && !readFileSync(absolute).equals(bytes))
      throw new Error(`Migration verification failed: ${path}`);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export const appPackagePath = (app: Pick<AppDescriptor, "id" | "name" | "kind">) =>
  `${app.kind === "preset" || app.id === "__transient__" ? "System/Applications" : "Applications"}/${contentName(app.name, app.id)}/app.json`;

export function writeAppPackage(
  app: AppDescriptor,
  path = appPackagePath(app),
  migration = false,
): string {
  const { seedHtml, ...manifest } = app.manifest;
  if (seedHtml !== undefined) writeContent(`${dirname(path)}/index.html`, seedHtml, migration);
  writeContent(
    path,
    JSON.stringify(
      { ...app, manifest, entry: seedHtml === undefined ? undefined : "index.html" },
      null,
      2,
    ),
    migration,
  );
  return path;
}

export function readAppPackage(path: string): AppDescriptor {
  const app = JSON.parse(readFileSync(diskPath(path, true), "utf8"));
  if (
    !app ||
    typeof app.name !== "string" ||
    !app.manifest ||
    typeof app.manifest !== "object" ||
    Array.isArray(app.manifest)
  ) {
    throw new Error(`Invalid app package: ${path}`);
  }
  if (app.entry !== undefined) {
    if (app.entry !== "index.html") throw new Error(`Invalid app entry: ${path}`);
    app.manifest.seedHtml = readFileSync(diskPath(`${dirname(path)}/index.html`, true), "utf8");
  }
  return app;
}

export function snapshotFile(
  window: { id: string; title: string; app_id: string },
  appPath: string,
): string {
  return window.app_id === "__transient__"
    ? `Applications/${contentName(window.title, window.id)}/index.html`
    : `${dirname(appPath)}/Windows/${contentName(window.title, window.id)}.html`;
}

export function imageFile(id: string, mime: string): string {
  const extension =
    (
      {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/avif": "avif",
        "image/svg+xml": "svg",
      } as Record<string, string>
    )[mime] ?? "bin";
  return `Medias/Images/${encodeURIComponent(id)}.${extension}`;
}
