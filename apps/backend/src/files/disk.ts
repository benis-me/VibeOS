import {
  constants,
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  FILE_TEXT_LIMIT,
  SYSTEM_FOLDERS,
  FILE_UPLOAD_LIMIT,
  type DiskCommand,
  type DiskEntry,
  type DiskResult,
} from "@vibeos/shared/domain";
import { env } from "../config/env.ts";
import { readShortcut } from "./shortcuts.ts";
import { bus, messageContext } from "../events/bus.ts";

const fail = (code: string): never => {
  throw new Error(code);
};
const version = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function diskRoot(): string {
  mkdirSync(env.diskDir, { recursive: true, mode: 0o700 });
  return realpathSync(env.diskDir);
}

/** Check every existing path component, including parents of a new file. */
export function diskPath(path: string, internal = false): string {
  const parts = path ? path.split("/") : [];
  if (
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in untrusted paths.
    /[\\\x00-\x1f]/.test(path) ||
    /^[a-z]:/i.test(path) ||
    parts.some((p) => !p || p === "." || p === "..") ||
    (!internal && (parts[0] === "Trash" || parts[0] === ".Trash"))
  )
    fail("path");
  const root = diskRoot();
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) fail("symlink");
      current = realpathSync(current);
      if (current !== root && !current.startsWith(root + sep)) fail("path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!internal && ["Trash", ".Trash"].includes(relative(root, current).split(sep)[0]!))
    fail("path");
  return current;
}

/** Resolve casing/normalization using the host filesystem before matching runtime indexes. */
export function canonicalFileCommand<
  T extends { action: string; path: string; destination?: string },
>(command: T): T {
  const canonical = (path: string) =>
    relative(diskRoot(), diskPath(path, true)).split(sep).join("/");
  return {
    ...command,
    path: ["restore", "delete"].includes(command.action) ? command.path : canonical(command.path),
    ...("destination" in command ? { destination: canonical(command.destination!) } : {}),
  };
}

const signatures = new Map<string, string>();
const visibleChange = (path: string) =>
  !!path &&
  !/^(System|Cache)(\/|$)/.test(path) &&
  !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$/.test(path) &&
  !path.includes(".vibeos-write-");
const signature = (path: string) => {
  try {
    const stat = lstatSync(diskPath(path, true), { bigint: true });
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch {
    return "missing";
  }
};
function rememberChange(path: string) {
  signatures.delete(path);
  signatures.set(path, signature(path));
  // ponytail: bounded watcher deduplication; older paths simply get a fresh external notification.
  if (signatures.size > 4096) signatures.delete(signatures.keys().next().value!);
}
export function noteDiskChanges(paths: string[]) {
  const changed = [...new Set(paths)].filter(visibleChange);
  for (const path of changed) {
    rememberChange(path);
    // Creating, replacing or removing an entry also produces parent-directory watch events.
    for (let parent = dirname(path); parent !== "."; parent = dirname(parent))
      rememberChange(parent);
  }
  if (changed.length) {
    const trace = messageContext.getStore();
    // Repositories finish their synchronous SQL/index updates before readers observe the change.
    queueMicrotask(() => bus.emit("disk.changed", { paths: changed, trace }));
  }
}

function fileBytes(path: string, limit: number): Buffer {
  const absolute = diskPath(path);
  if (!lstatSync(absolute).isFile()) fail("notFile");
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) fail("notFile");
    if (stat.size > limit) fail("tooLarge");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function entry(path: string, internal = false, originalPath = path): DiskEntry {
  const abs = internal ? join(diskRoot(), path) : diskPath(path);
  const stat = lstatSync(abs);
  let shortcut: ReturnType<typeof readShortcut> | undefined;
  let application: { id: string; icon?: string } | undefined;
  if (stat.isDirectory() && originalPath.toLowerCase().endsWith(".vibeapp")) {
    try {
      const manifest = diskPath(`${path}/manifest.json`, true);
      if (lstatSync(manifest).size < 128 * 1024) {
        const value = JSON.parse(readFileSync(manifest, "utf8"));
        if (
          value.format === 2 &&
          typeof value.id === "string" &&
          /^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
        )
          application = {
            id: value.id,
            icon: typeof value.icon === "string" ? value.icon : undefined,
          };
      }
    } catch {
      /* A damaged bundle remains inspectable as a folder. */
    }
  }
  if (stat.isFile() && originalPath.toLowerCase().endsWith(".vibelink")) {
    try {
      shortcut = readShortcut(abs);
    } catch {
      /* Invalid links remain ordinary files. */
    }
  }
  return {
    path,
    name: basename(path),
    kind: stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? application
          ? "application"
          : "directory"
        : shortcut
          ? "shortcut"
          : "file",
    targetAppId: application?.id ?? shortcut?.appId,
    icon: application?.icon ?? shortcut?.icon,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
  };
}

function list(path: string): DiskEntry[] {
  if (path === "Trash" || path === ".Trash") {
    const trash = diskPath("Trash", true);
    if (!existsSync(trash)) return [];
    return readdirSync(trash)
      .filter((id) => /^[0-9a-f-]{36}$/.test(id))
      .map((id) => {
        const info = trashInfo(id);
        return {
          ...entry(`Trash/${id}/item`, true, info.path),
          path: id,
          name: basename(info.path),
          originalPath: info.path,
        };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt);
  }
  return readdirSync(diskPath(path))
    .filter(
      (name) =>
        name !== ".Trash" &&
        name !== ".DS_Store" &&
        name !== "Thumbs.db" &&
        name !== "desktop.ini" &&
        !name.startsWith("._") &&
        !name.includes(".vibeos-write-"),
    )
    .map((name) => entry(path ? `${path}/${name}` : name, true))
    .sort(
      (a, b) =>
        Number(b.kind === "directory") - Number(a.kind === "directory") ||
        a.name.localeCompare(b.name),
    );
}

function trashInfo(id: string): { path: string; container: string } {
  if (!/^[0-9a-f-]{36}$/.test(id)) fail("path");
  const container = diskPath(`Trash/${id}`, true);
  const info = JSON.parse(readFileSync(diskPath(`Trash/${id}/info.json`, true), "utf8"));
  if (typeof info.path !== "string" || !info.path) fail("path");
  diskPath(info.path);
  diskPath(`Trash/${id}/item`, true);
  return { path: info.path, container };
}

function assertMutable(path: string): void {
  path = canonicalFileCommand({ action: "write", path }).path;
  if ((SYSTEM_FOLDERS as readonly string[]).includes(path) || path.startsWith("System/"))
    fail("systemFolder");
  // Published bundles are immutable; edit them through the application version command.
  if (/\.vibeapp\//i.test(path)) fail("systemFolder");
}

/** Synchronous filesystem mutations serialize naturally within the Bun event loop. */
function executeDiskCommand(command: DiskCommand): DiskResult {
  if (command.action === "list") return { entries: list(command.path) };
  if (command.action === "stat")
    return { entry: command.path === "Trash" ? entry("Trash", true) : entry(command.path) };
  if (command.action === "restore" || command.action === "delete") {
    const info = trashInfo(command.path);
    if (command.action === "restore") {
      assertMutable(info.path);
      const target = diskPath(info.path);
      if (existsSync(target)) fail("exists");
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      renameSync(join(info.container, "item"), target);
    }
    rmSync(info.container, { recursive: true });
    return { path: info.path };
  }
  if (!command.path) fail("path");
  const path = diskPath(command.path);
  if (command.action !== "read" && command.action !== "copy") assertMutable(command.path);
  switch (command.action) {
    case "read": {
      const bytes = fileBytes(command.path, FILE_TEXT_LIMIT);
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return fail("binary");
      }
      if (content.includes("\0")) fail("binary");
      return { content, version: version(bytes) };
    }
    case "write": {
      const bytes = Buffer.from(command.content, command.encoding ?? "utf8");
      if (command.encoding && bytes.toString("base64") !== command.content) fail("encoding");
      if (bytes.length > FILE_UPLOAD_LIMIT) fail("tooLarge");
      const replacing = existsSync(path);
      if (replacing && !command.version) fail("exists");
      if (
        command.version &&
        (!replacing || version(fileBytes(command.path, FILE_UPLOAD_LIMIT)) !== command.version)
      )
        fail("conflict");
      const temporary = join(dirname(path), `.vibeos-write-${randomUUID()}`);
      try {
        writeFileSync(temporary, bytes, {
          flag: "wx",
          mode: replacing ? lstatSync(path).mode & 0o777 : 0o600,
        });
        if (replacing) renameSync(temporary, path);
        else linkSync(temporary, path);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
      return { path: command.path, version: version(bytes) };
    }
    case "mkdir":
      mkdirSync(path, { mode: 0o700 });
      return { path: command.path };
    case "move":
    case "copy": {
      if (!command.destination) fail("path");
      assertMutable(command.destination);
      const target = diskPath(command.destination);
      if (existsSync(target)) fail("exists");
      const descendant = relative(path, target);
      if (
        !descendant ||
        (!descendant.startsWith(`..${sep}`) && descendant !== ".." && !descendant.startsWith(sep))
      )
        fail("path");
      if (command.action === "move") renameSync(path, target);
      else
        cpSync(path, target, {
          recursive: true,
          errorOnExist: true,
          force: false,
          verbatimSymlinks: true,
        });
      return { path: command.destination };
    }
    case "trash":
      return trashContent(command.path);
  }
}

export function diskError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return "missing";
  if (code === "EEXIST" || code === "ENOTEMPTY") return "exists";
  if (code === "EACCES" || code === "EPERM") return "permission";
  const message = error instanceof Error ? error.message : "";
  return [
    "path",
    "symlink",
    "notFile",
    "systemFolder",
    "tooLarge",
    "binary",
    "encoding",
    "exists",
    "conflict",
    "shortcut",
    "missingApp",
  ].includes(message)
    ? message
    : "failed";
}

export function executeDisk(input: DiskCommand): DiskResult {
  const command = canonicalFileCommand(input);
  const result = executeDiskCommand(command);
  if (!["list", "read", "stat"].includes(command.action)) {
    const from = ["restore", "delete"].includes(command.action)
      ? `Trash/${command.path}`
      : command.path;
    const to = command.action === "trash" ? `Trash/${result.path}` : result.path;
    noteDiskChanges([from, ...(to ? [to] : [])]);
  }
  return result;
}

export function watchDisk(changed: (paths: string[]) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();
  const watcher = watch(diskRoot(), { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const path = String(filename).split(sep).join("/");
    if (!visibleChange(path)) return;
    pending.add(path);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const paths = [...pending].filter((p) => signatures.get(p) !== signature(p));
      pending.clear();
      for (const p of paths) rememberChange(p);
      if (paths.length) changed(paths);
    }, 120);
  });
  watcher.on("error", (error) => console.warn("[files] watch failed", error.message));
  watcher.unref();
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

/** Internal repositories may archive their own protected system content. Never exposed as a file command. */
export function trashContent(relativePath: string): DiskResult {
  const id = randomUUID();
  const container = diskPath(`Trash/${id}`, true);
  mkdirSync(container, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(container, "info.json"), JSON.stringify({ path: relativePath }), {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(diskPath(relativePath, true), join(container, "item"));
  } catch (error) {
    rmSync(container, { recursive: true });
    throw error;
  }
  return { path: id };
}
