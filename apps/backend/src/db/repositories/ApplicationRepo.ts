import { persistApplicationAssets } from "./ApplicationPackageRepo.ts";
import { existsSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  applicationDefinitionSchema,
  appDataWriteSchema,
  messageDataSchema,
  type AppDescriptor,
  type ApplicationDefinition,
  type ApplicationRequest,
  type ApplicationState,
  type AppDataSnapshot,
  type MessageData,
} from "@vibeos/shared/domain";
import { ulid, stripEmoji } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";
import { getApp, installApp, listApps } from "./AppRepo.ts";
import { getWindow } from "./WindowRepo.ts";
import { getSnapshot } from "./AppMemoryRepo.ts";
import { contentName, writeContent } from "../../files/content.ts";
import { diskPath } from "../../files/disk.ts";
import { applyDiskMutation } from "./VfsRepo.ts";

interface AppIndex {
  id: string;
  content_path: string;
  active_version_id: string | null;
  origin_app_id: string | null;
}
interface VersionRow {
  id: string;
  app_id: string;
  path: string;
  number: number;
  summary: string;
  schema_version: number;
  legacy: number;
  created_at: number;
}
interface RequestRow {
  id: string;
  app_id: string;
  prompt: string;
  base_version_id: string;
  source_window_id: string | null;
  data_version: string;
  status: ApplicationRequest["status"];
  chars: number;
  summary: string;
  error: string | null;
  version_id: string | null;
  created_at: number;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const index = (id: string) =>
  getDb()
    .query<AppIndex, [string]>(
      "SELECT id, content_path, active_version_id, origin_app_id FROM apps WHERE id = ?",
    )
    .get(id);
const dataPath = (id: string) => `System/AppData/${encodeURIComponent(id)}/state.json`;
const safeDefinition = (app: AppDescriptor): ApplicationDefinition => ({
  ...applicationDefinitionSchema.parse({
    description: app.manifest.description ?? "",
    instructions: app.manifest.instructions ?? app.manifest.description ?? "",
    seedHtml: "",
    fileTypes: app.manifest.fileTypes ?? [],
    operations: app.manifest.operations ?? [],
    dataSchemaVersion: app.manifest.dataSchemaVersion ?? 1,
    assets: app.manifest.assets ?? {},
  }),
  seedHtml: app.manifest.seedHtml ?? "",
  defaultSize: app.manifest.defaultSize,
});

export function readApplicationVersion(
  appId: string,
  versionId?: string,
): ApplicationDefinition | undefined {
  const id = versionId ?? index(appId)?.active_version_id;
  if (!id) return;
  const row = getDb()
    .query<VersionRow, [string, string]>("SELECT * FROM app_versions WHERE id = ? AND app_id = ?")
    .get(id, appId);
  if (!row) throw new Error("applications.error.version");
  const definition = JSON.parse(readFileSync(diskPath(row.path, true), "utf8"));
  definition.seedHtml = readFileSync(diskPath(`${dirname(row.path)}/index.html`, true), "utf8");
  return row.legacy
    ? {
        ...applicationDefinitionSchema.parse({
          ...definition,
          seedHtml: "",
          defaultSize: undefined,
        }),
        seedHtml: definition.seedHtml,
        defaultSize: definition.defaultSize,
      }
    : applicationDefinitionSchema.parse(definition);
}

function writeVersion(
  app: AppDescriptor,
  definition: ApplicationDefinition,
  summary: string,
  legacy = false,
): string {
  const db = getDb();
  const row = index(app.id)!;
  const id = ulid();
  const number = db
    .query<{ n: number }, [number, string]>(
      "SELECT COALESCE(MAX(number), ?) + 1 n FROM app_versions WHERE app_id = ?",
    )
    .get(definition.seedHtml ? 0 : -1, app.id)!.n;
  const path = `${dirname(row.content_path)}/Versions/${id}/definition.json`;
  const { seedHtml, ...meta } = definition;
  writeContent(`${dirname(path)}/index.html`, seedHtml, true);
  writeContent(path, JSON.stringify(meta, null, 2), true);
  persistApplicationAssets(definition, dirname(path), !legacy);
  db.query(
    "INSERT INTO app_versions (id,app_id,number,path,summary,schema_version,legacy,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    id,
    app.id,
    number,
    path,
    stripEmoji(summary),
    definition.dataSchemaVersion,
    Number(legacy),
    Date.now(),
  );
  writeContent(
    row.content_path,
    JSON.stringify(
      {
        ...app,
        format: 2,
        manifest: meta,
        entry: `Versions/${id}/index.html`,
        activeVersionId: id,
      },
      null,
      2,
    ),
  );
  db.query("UPDATE apps SET active_version_id = ?, updated_at = ? WHERE id = ?").run(
    id,
    Date.now(),
    app.id,
  );
  return id;
}

/** Called inside AppRepo's writer queue, after the package index exists. */
export function initializeApplication(app: AppDescriptor): void {
  if (app.kind !== "virtual" || app.id === "__transient__" || index(app.id)?.active_version_id)
    return;
  writeVersion(app, safeDefinition(app), "Initial version", !!app.manifest.seedHtml);
}

export function getAppData(appId: string): AppDataSnapshot {
  const app = getApp(appId);
  if (!app) throw new Error("applications.error.missing");
  const path = dataPath(appId);
  const raw = existsSync(diskPath(path, true))
    ? readFileSync(diskPath(path, true), "utf8")
    : JSON.stringify({ schemaVersion: app.manifest.dataSchemaVersion ?? 1, data: {} });
  const stored = JSON.parse(raw);
  return {
    appId,
    version: hash(raw),
    schemaVersion: stored.schemaVersion,
    data: messageDataSchema.parse(stored.data),
  };
}

function putData(appId: string, data: MessageData, schemaVersion: number) {
  const raw = JSON.stringify({ schemaVersion, data: messageDataSchema.parse(data) }, null, 2);
  writeContent(dataPath(appId), raw);
}

export function setAppData(
  appId: string,
  input: unknown,
  beforeWrite = () => {},
): Promise<AppDataSnapshot> {
  const next = appDataWriteSchema.parse(input);
  return enqueue(() => {
    beforeWrite();
    const current = getAppData(appId);
    if (current.version !== next.version) throw new Error("applications.error.dataConflict");
    if (isDeepStrictEqual(current.data, next.data)) return current;
    putData(appId, next.data, current.schemaVersion);
    return getAppData(appId);
  });
}

export function applicationState(): ApplicationState {
  const db = getDb();
  return {
    applications: listApps()
      .filter((a) => a.kind === "virtual")
      .map((app) => {
        const row = index(app.id)!;
        return {
          appId: app.id,
          path: dirname(row.content_path),
          activeVersionId: row.active_version_id ?? "",
          originAppId: row.origin_app_id ?? undefined,
          versions: db
            .query<VersionRow, [string]>(
              "SELECT * FROM app_versions WHERE app_id = ? ORDER BY number DESC",
            )
            .all(app.id)
            .map((v) => ({
              id: v.id,
              number: v.number,
              summary: v.summary,
              createdAt: v.created_at,
              dataSchemaVersion: v.schema_version,
              legacy: !!v.legacy,
            })),
          requests: db
            .query<RequestRow, [string]>(
              "SELECT * FROM app_requests WHERE app_id = ? ORDER BY created_at DESC LIMIT 30",
            )
            .all(app.id)
            .map(requestFromRow),
        };
      }),
  };
}

const requestFromRow = (r: RequestRow): ApplicationRequest => ({
  id: r.id,
  appId: r.app_id,
  prompt: r.prompt,
  baseVersionId: r.base_version_id,
  status: r.status,
  chars: r.chars,
  summary: r.summary,
  error: r.error ?? undefined,
  versionId: r.version_id ?? undefined,
  createdAt: r.created_at,
});
export function getApplicationRequest(id: string) {
  return getDb().query<RequestRow, [string]>("SELECT * FROM app_requests WHERE id = ?").get(id);
}

export function startApplicationRequest(appId: string, prompt: string, sourceWindowId?: string) {
  return enqueue(() => {
    const app = getApp(appId);
    if (!app || app.kind !== "virtual") throw new Error("applications.error.readOnly");
    if (sourceWindowId && getWindow(sourceWindowId)?.appId !== appId)
      throw new Error("applications.error.window");
    const row = index(appId)!;
    const id = ulid(),
      now = Date.now();
    getDb()
      .query(
        "INSERT INTO app_requests (id,app_id,prompt,base_version_id,source_window_id,data_version,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'generating',?,?)",
      )
      .run(
        id,
        appId,
        stripEmoji(prompt),
        row.active_version_id!,
        sourceWindowId ?? null,
        getAppData(appId).version,
        now,
        now,
      );
    return getApplicationRequest(id)!;
  });
}

export function updateApplicationRequest(
  id: string,
  status: ApplicationRequest["status"],
  chars = 0,
  error?: string,
) {
  return enqueue(() => {
    getDb()
      .query(
        "UPDATE app_requests SET status = ?, chars = ?, error = ?, updated_at = ? WHERE id = ? AND status IN ('generating','validating')",
      )
      .run(status, chars, error ?? null, Date.now(), id);
  });
}

export function publishApplicationVersion(
  requestId: string,
  definition: ApplicationDefinition,
  summary: string,
  migratedData: MessageData | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  return enqueue(() => {
    const request = getApplicationRequest(requestId);
    if (!request || !["generating", "validating"].includes(request.status) || signal.aborted)
      return false;
    const app = getApp(request.app_id);
    if (!app || !app.isInstalled) throw new Error("applications.error.missing");
    if (index(app.id)?.active_version_id !== request.base_version_id)
      throw new Error("applications.error.versionConflict");
    const safe = applicationDefinitionSchema.parse(definition);
    const current = getAppData(app.id);
    const changingSchema = safe.dataSchemaVersion !== current.schemaVersion;
    if (changingSchema && migratedData === undefined)
      throw new Error("applications.error.migration");
    if (migratedData !== undefined) {
      const base = getDb()
        .query<{ legacy: number }, [string]>("SELECT legacy FROM app_versions WHERE id=?")
        .get(request.base_version_id);
      if (!changingSchema && (!base?.legacy || JSON.stringify(current.data) !== "{}"))
        throw new Error("applications.error.migration");
      if (current.version !== request.data_version)
        throw new Error("applications.error.dataConflict");
      writeContent(
        `System/AppData/${encodeURIComponent(app.id)}/Backups/${ulid()}.json`,
        JSON.stringify(current, null, 2),
        true,
      );
    }
    getDb().transaction(() => {
      const versionId = writeVersion(app, safe, summary);
      if (migratedData !== undefined) putData(app.id, migratedData, safe.dataSchemaVersion);
      getDb()
        .query(
          "UPDATE app_requests SET status='succeeded', version_id=?, summary=?, updated_at=? WHERE id=?",
        )
        .run(versionId, stripEmoji(summary), Date.now(), requestId);
    })();
    return true;
  });
}

export function activateApplicationVersion(appId: string, versionId: string): Promise<void> {
  return enqueue(() => {
    const definition = readApplicationVersion(appId, versionId);
    if (!definition || definition.dataSchemaVersion !== getAppData(appId).schemaVersion)
      throw new Error("applications.error.schema");
    const app = getApp(appId)!;
    const { seedHtml, ...manifest } = definition;
    writeContent(
      index(appId)!.content_path,
      JSON.stringify(
        {
          ...app,
          format: 2,
          manifest,
          entry: `Versions/${versionId}/index.html`,
          activeVersionId: versionId,
        },
        null,
        2,
      ),
    );
    getDb()
      .query("UPDATE apps SET active_version_id=?, updated_at=? WHERE id=?")
      .run(versionId, Date.now(), appId);
  });
}

export function renameApplication(appId: string, name: string): Promise<void> {
  return enqueue(() => {
    const app = getApp(appId);
    if (!app || app.kind !== "virtual") throw new Error("applications.error.readOnly");
    const row = index(appId)!;
    const root = dirname(row.content_path);
    const target = `${dirname(root)}/${contentName(name, app.id)}.vibeapp`;
    if (root !== target && existsSync(diskPath(target))) throw new Error("exists");
    if (!stripEmoji(name).trim()) throw new Error("applications.error.name");
    const meta = JSON.parse(readFileSync(diskPath(row.content_path), "utf8"));
    meta.name = stripEmoji(name);
    meta.updatedAt = Date.now();
    writeContent(row.content_path, JSON.stringify(meta, null, 2));
    if (root !== target) applyDiskMutation({ action: "move", path: root, destination: target });
    getDb()
      .query("UPDATE apps SET name=?, updated_at=? WHERE id=?")
      .run(meta.name, meta.updatedAt, appId);
  });
}

export async function duplicateApplication(appId: string, name?: string) {
  const original = getApp(appId);
  if (!original || original.kind !== "virtual") throw new Error("applications.error.readOnly");
  const definition = readApplicationVersion(appId)!;
  // Legacy snapshots can contain private records. A copy regenerates its initial UI.
  const version = getDb()
    .query<VersionRow, [string]>("SELECT * FROM app_versions WHERE id=?")
    .get(index(appId)!.active_version_id!);
  const app = await installApp({
    name: name ?? `${original.name} Copy`,
    icon: original.icon,
    manifest: { ...definition, seedHtml: version?.legacy ? "" : definition.seedHtml },
  });
  await enqueue(() => {
    getDb().query("UPDATE apps SET origin_app_id=? WHERE id=?").run(appId, app.id);
    getDb()
      .query("UPDATE app_versions SET legacy=? WHERE app_id=?")
      .run(version?.legacy ?? 0, app.id);
  });
  return app;
}

export async function saveWindowAsApplication(windowId: string, name?: string, icon?: string) {
  const window = getWindow(windowId);
  if (!window?.isOpen) throw new Error("applications.error.window");
  const snapshot = getSnapshot(windowId);
  if (!snapshot.trim()) throw new Error("applications.error.empty");
  let app = getApp(window.appId)!;
  if (app.kind !== "virtual" || app.id === "__transient__") {
    app = await installApp({
      name: name ?? window.title,
      icon: icon ?? app.icon,
      manifest: {
        description: app.manifest.description,
        defaultSize: { w: window.rect.w, h: window.rect.h },
        seedHtml: snapshot,
      },
    });
  } else {
    await enqueue(() => {
      getDb().query("UPDATE apps SET is_installed=1 WHERE id=?").run(app.id);
      writeVersion(
        app,
        {
          ...safeDefinition(app),
          defaultSize: { w: window.rect.w, h: window.rect.h },
          seedHtml: snapshot,
        },
        "Saved current experience",
        true,
      );
    });
    await renameApplication(app.id, name ?? app.name);
  }
  const appId = app.id;
  await enqueue(() => {
    getDb()
      .query("UPDATE windows SET app_id=?, app_version_id=? WHERE id=?")
      .run(appId, index(appId)!.active_version_id, windowId);
    getDb().query("UPDATE app_memory SET app_id=? WHERE window_id=?").run(appId, windowId);
  });
  return getApp(appId)!;
}

export function clearApplicationData(appId: string) {
  return enqueue(() => {
    const current = getAppData(appId);
    writeContent(
      `System/AppData/${encodeURIComponent(appId)}/Backups/${ulid()}.json`,
      JSON.stringify(current, null, 2),
      true,
    );
    putData(appId, {}, current.schemaVersion);
    return getAppData(appId);
  });
}

/** v3 retains all old snapshots before moving the package index; retry reuses copied bytes. */
export async function migrateApplications() {
  const db = getDb();
  if (!db.query("SELECT version FROM storage_version WHERE version >= 3").get()) {
    const windows = db
      .query<{ window_id: string; snapshot_path: string | null; html_snapshot: string }, []>(
        "SELECT window_id,snapshot_path,html_snapshot FROM app_memory",
      )
      .all();
    await enqueue(() => {
      for (const row of windows) {
        const html = row.snapshot_path
          ? readFileSync(diskPath(row.snapshot_path, true), "utf8")
          : row.html_snapshot;
        const path = `System/Sessions/${encodeURIComponent(row.window_id)}/index.html`;
        if (path !== row.snapshot_path) writeContent(path, html, true);
        db.query("UPDATE app_memory SET snapshot_path=? WHERE window_id=?").run(
          path,
          row.window_id,
        );
      }
    });
    for (const row of db
      .query<{ id: string }, []>("SELECT id FROM apps WHERE kind='virtual' AND id!='__transient__'")
      .all()) {
      await enqueue(() => {
        const app = getApp(row.id);
        if (!app) return;
        const prior = index(row.id)!;
        if (prior.active_version_id) return;
        const root = `${app.isInstalled ? "Applications" : "Cache/Applications"}/${contentName(app.name, app.id)}.vibeapp`;
        const path = `${root}/manifest.json`;
        const { seedHtml, ...manifest } = app.manifest;
        writeContent(path, JSON.stringify({ ...app, format: 2, manifest }, null, 2), true);
        db.query("UPDATE apps SET content_path=? WHERE id=?").run(path, app.id);
        initializeApplication(app);
        db.query("UPDATE windows SET app_version_id=? WHERE app_id=?").run(
          index(app.id)!.active_version_id,
          app.id,
        );
        const old = dirname(prior.content_path);
        if (old !== root && existsSync(diskPath(old, true))) {
          const archive = `System/LegacyApplications/${encodeURIComponent(app.id)}`;
          mkdirSync(dirname(diskPath(archive, true)), { recursive: true });
          if (!existsSync(diskPath(archive, true)))
            renameSync(diskPath(old, true), diskPath(archive, true));
        }
      });
    }
    // Each old temporary experience receives its own identity; window IDs and bytes stay intact.
    for (const w of db
      .query<{ id: string; title: string; w: number; h: number }, []>(
        "SELECT id,title,w,h FROM windows WHERE app_id='__transient__'",
      )
      .all()) {
      const app = await installApp({
        name: w.title,
        isInstalled: false,
        manifest: {
          description: w.title,
          seedHtml: getSnapshot(w.id),
          defaultSize: { w: w.w, h: w.h },
        },
      });
      await enqueue(() => {
        db.query("UPDATE windows SET app_id=?,app_version_id=? WHERE id=?").run(
          app.id,
          index(app.id)!.active_version_id,
          w.id,
        );
        db.query("UPDATE app_memory SET app_id=? WHERE window_id=?").run(app.id, w.id);
      });
    }
    await enqueue(() => {
      for (const old of new Set(
        windows
          .map((w) => w.snapshot_path?.split("/Windows/")[0])
          .filter((p): p is string => !!p && p.startsWith("Applications/")),
      )) {
        if (!existsSync(diskPath(old, true))) continue;
        const archive = `System/LegacyApplications/${hash(old).slice(0, 24)}`;
        mkdirSync(dirname(diskPath(archive, true)), { recursive: true });
        if (!existsSync(diskPath(archive, true)))
          renameSync(diskPath(old, true), diskPath(archive, true));
      }
    });
    await enqueue(() =>
      db
        .query("INSERT INTO storage_version (version, completed_at, backup_path) VALUES (3,?,NULL)")
        .run(Date.now()),
    );
  }
  await enqueue(() =>
    db
      .query(
        "UPDATE app_requests SET status='interrupted',error='applications.error.interrupted' WHERE status IN ('generating','validating')",
      )
      .run(),
  );
}

export function applicationPath(appId: string): string {
  const row = index(appId);
  if (!row) throw new Error("applications.error.missing");
  return dirname(row.content_path);
}
export function retireApplication(appId: string) {
  return enqueue(() => {
    getDb().query("UPDATE apps SET is_installed=0 WHERE id=?").run(appId);
    getDb()
      .query(
        "UPDATE app_requests SET status='cancelled' WHERE app_id=? AND status IN ('generating','validating')",
      )
      .run(appId);
  });
}
/** Runs after the shared file path indexes have followed a bundle mutation. */
export function syncApplicationInstallation(
  command: import("@vibeos/shared").DiskCommand,
  result: import("@vibeos/shared").DiskResult,
): string[] {
  if (!["move", "trash", "restore", "delete"].includes(command.action)) return [];
  const path =
    command.action === "trash"
      ? `Trash/${result.path}/item`
      : command.action === "delete"
        ? `Trash/${command.path}/item`
        : result.path!;
  const rows = getDb()
    .query<{ id: string }, [number, string]>("SELECT id FROM apps WHERE substr(content_path,1,?)=?")
    .all(path.length + 1, `${path}/`);
  for (const { id } of rows) {
    if (command.action === "trash" || command.action === "delete") {
      getDb().query("UPDATE apps SET is_installed=0 WHERE id=?").run(id);
      getDb()
        .query(
          "UPDATE app_requests SET status='cancelled' WHERE app_id=? AND status IN ('generating','validating')",
        )
        .run(id);
    } else if (command.action === "restore")
      getDb().query("UPDATE apps SET is_installed=1 WHERE id=?").run(id);
  }
  return rows.map((row) => row.id);
}
