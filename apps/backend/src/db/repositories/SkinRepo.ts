import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import {
  SKINS,
  MAX_SKIN_PACKAGE_BYTES,
  skinPackageSchema,
  type SkinPackage,
  isBuiltinSkin,
  emptySkinDefinition,
  skinDefinitionSchema,
  skinRequestRunning,
  type Skin,
  type BuiltinSkin,
  type SkinDefinition,
  type SkinRecord,
  type SkinRequest,
  type SkinRequestStatus,
  type SkinState,
  type SkinVersion,
} from "@vibeos/shared/domain";
import { stripEmoji, ulid } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { hasImage, getImage, putImage } from "./ImagesRepo.ts";
import { enqueue } from "./writeQueue.ts";
import { loadSettings, updateSettings } from "./SettingsRepo.ts";
import { writeContent } from "../../files/content.ts";
import { diskPath, trashContent } from "../../files/disk.ts";

interface Row {
  id: Skin;
  name: string;
  foundation: BuiltinSkin | null;
  initial_path: string;
  active_version_id: string | null;
}
const requestColumns =
  "id, skin_id AS skinId, prompt, base_version_id AS baseVersionId, status, chars, summary, error, version_id AS versionId, created_at AS createdAt, updated_at AS updatedAt";
function custom(id: string): Row {
  if (isBuiltinSkin(id)) throw new Error("skins.error.readonly");
  const row = getDb().query<Row, [string]>("SELECT * FROM skins WHERE id = ?").get(id);
  if (!row) throw new Error("skins.error.missing");
  return row;
}
function readDefinition(path: string): SkinDefinition {
  return skinDefinitionSchema.parse(JSON.parse(readFileSync(diskPath(path, true), "utf8")));
}
export function getSkin(id: Skin, tolerateBroken = false): SkinRecord {
  if (isBuiltinSkin(id))
    return {
      id,
      name: SKINS.find((s) => s.id === id)!.label,
      builtIn: true,
      foundation: id,
      activeVersionId: null,
      definition: emptySkinDefinition(),
      versions: [],
      requests: [],
    };
  const row = custom(id);
  const db = getDb();
  const path = row.active_version_id
    ? db
        .query<{ path: string }, [string, string]>(
          "SELECT path FROM skin_versions WHERE skin_id = ? AND id = ?",
        )
        .get(id, row.active_version_id)?.path
    : row.initial_path;
  let definition = emptySkinDefinition(),
    loadError = false;
  try {
    if (!path) throw new Error("skins.error.content");
    definition = readDefinition(path);
  } catch {
    if (!tolerateBroken) throw new Error("skins.error.content");
    loadError = true;
  }
  return {
    id,
    name: row.name,
    builtIn: false,
    foundation: row.foundation,
    activeVersionId: row.active_version_id,
    definition,
    ...(loadError ? { loadError } : {}),
    versions: db
      .query<SkinVersion, [string]>(
        "SELECT id, number, summary, created_at AS createdAt FROM skin_versions WHERE skin_id = ? ORDER BY number",
      )
      .all(id),
    requests: db
      .query<SkinRequest, [string]>(
        `SELECT ${requestColumns} FROM skin_requests WHERE skin_id = ? ORDER BY created_at, id`,
      )
      .all(id),
  };
}
export function skinState(): SkinState {
  // ponytail: personal collection fits one metadata snapshot; paginate histories if large collections make it costly.
  return {
    skins: [
      ...SKINS.map((s) => getSkin(s.id)),
      ...getDb()
        .query<Row, []>("SELECT * FROM skins ORDER BY created_at, id")
        .all()
        .map((row) => getSkin(row.id, true)),
    ],
  };
}
export function getSkinRequest(id: string): SkinRequest | null {
  return getDb()
    .query<SkinRequest, [string]>(`SELECT ${requestColumns} FROM skin_requests WHERE id = ?`)
    .get(id);
}
export async function createSkin(
  name: string,
  sourceId?: Skin,
  initial?: Pick<SkinRecord, "definition" | "foundation">,
): Promise<Skin> {
  const id: Skin = `skin-${ulid()}`;
  await updateSettings(() => {
    const source = initial ?? (sourceId ? getSkin(sourceId) : null);
    const now = Date.now();
    const path = `System/Skins/${id}/initial.json`;
    writeContent(path, JSON.stringify(source?.definition ?? emptySkinDefinition(), null, 2), true);
    getDb()
      .query(
        "INSERT INTO skins (id, name, foundation, initial_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, cleanName(name), source?.foundation ?? null, path, now, now);
    return { skin: id };
  });
  return id;
}
function cleanName(name: string): string {
  const value = stripEmoji(name).trim();
  if (!value || value.length > 80) throw new Error("skins.error.name");
  return value;
}
export function renameSkin(id: Skin, name: string): Promise<void> {
  return enqueue(() => {
    custom(id);
    getDb()
      .query("UPDATE skins SET name = ?, updated_at = ? WHERE id = ?")
      .run(cleanName(name), Date.now(), id);
  });
}
export async function deleteSkin(id: Skin): Promise<void> {
  await updateSettings((current) => {
    const row = custom(id);
    const path = dirname(row.initial_path);
    if (existsSync(diskPath(path, true))) trashContent(path);
    getDb().query("DELETE FROM skins WHERE id = ?").run(id);
    return current.skin === id ? { skin: "devdock" } : {};
  });
}
export async function activateSkin(id: Skin, versionId?: string): Promise<void> {
  await updateSettings(() => {
    if (versionId) {
      custom(id);
      const version = getDb()
        .query<{ path: string }, [string, string]>(
          "SELECT path FROM skin_versions WHERE id = ? AND skin_id = ?",
        )
        .get(versionId, id);
      if (!version) throw new Error("skins.error.version");
      readDefinition(version.path);
      getDb()
        .query("UPDATE skins SET active_version_id = ?, updated_at = ? WHERE id = ?")
        .run(versionId, Date.now(), id);
    }
    getSkin(id);
    return { skin: id };
  });
}
export function startSkinRequest(id: Skin, prompt: string): Promise<SkinRequest> {
  return enqueue(() => {
    custom(id);
    const skin = getSkin(id);
    const requestId = ulid(),
      now = Date.now();
    getDb()
      .query(
        "INSERT INTO skin_requests (id, skin_id, prompt, base_version_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'generating', ?, ?)",
      )
      .run(requestId, id, stripEmoji(prompt), skin.activeVersionId, now, now);
    return getSkinRequest(requestId)!;
  });
}
/** Read the captured base even if another client switches versions while this request starts. */
export function skinRequestDefinition(request: SkinRequest): SkinDefinition {
  const row = custom(request.skinId);
  const path = request.baseVersionId
    ? getDb()
        .query<{ path: string }, [string, string]>(
          "SELECT path FROM skin_versions WHERE id = ? AND skin_id = ?",
        )
        .get(request.baseVersionId, row.id)?.path
    : row.initial_path;
  if (!path) throw new Error("skins.error.version");
  return readDefinition(path);
}

export function updateSkinRequest(
  id: string,
  status: SkinRequestStatus,
  chars: number,
  error = "",
): Promise<SkinRequest | null> {
  return enqueue(() => {
    getDb()
      .query(
        "UPDATE skin_requests SET status = ?, chars = ?, error = ?, updated_at = ? WHERE id = ? AND status IN ('generating', 'validating', 'assets', 'refining')",
      )
      .run(status, chars, stripEmoji(error).slice(0, 2000), Date.now(), id);
    return getSkinRequest(id);
  });
}
/** Commit the immutable version and selected version in the same writer turn as global selection. */
export async function publishSkinVersion(
  requestId: string,
  definition: SkinDefinition,
  summary: string,
  signal: AbortSignal,
): Promise<boolean> {
  let published = false;
  await updateSettings(() => {
    const request = getSkinRequest(requestId);
    if (!request || !skinRequestRunning(request.status) || signal.aborted) return {};
    const row = custom(request.skinId);
    const safe = skinDefinitionSchema.parse(definition);
    if (Object.values(safe.assets ?? {}).some((asset) => !asset.id || !hasImage(asset.id)))
      throw new Error("skins.error.images");
    const id = ulid(),
      now = Date.now();
    const path = `${dirname(row.initial_path)}/Versions/${id}.json`;
    const number =
      (getDb()
        .query<{ n: number }, [string]>(
          "SELECT COALESCE(MAX(number), 0) AS n FROM skin_versions WHERE skin_id = ?",
        )
        .get(row.id)?.n ?? 0) + 1;
    writeContent(path, JSON.stringify(safe, null, 2), true);
    getDb().transaction(() => {
      getDb()
        .query(
          "INSERT INTO skin_versions (id, skin_id, number, path, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, row.id, number, path, stripEmoji(summary), now);
      getDb()
        .query("UPDATE skins SET active_version_id = ?, updated_at = ? WHERE id = ?")
        .run(id, now, row.id);
      getDb()
        .query(
          "UPDATE skin_requests SET status = 'succeeded', version_id = ?, summary = ?, updated_at = ? WHERE id = ?",
        )
        .run(id, stripEmoji(summary), now, requestId);
    })();
    published = true;
    return { skin: row.id };
  });
  return published;
}
export async function recoverSkins(): Promise<void> {
  await enqueue(() =>
    getDb()
      .query(
        "UPDATE skin_requests SET status = 'interrupted', updated_at = ? WHERE status IN ('generating', 'validating', 'assets', 'refining')",
      )
      .run(Date.now()),
  );
  const active = loadSettings().skin;
  if (active) {
    try {
      getSkin(active);
    } catch {
      await updateSettings({ skin: "devdock" });
    }
  }
}

/** A portable snapshot of the selected version, including every referenced image. */
export function exportSkin(id: Skin): string {
  const skin = getSkin(id);
  const images: SkinPackage["images"] = {};
  for (const asset of Object.values(skin.definition.assets ?? {})) {
    const image = asset.id ? getImage(asset.id) : null;
    if (!asset.id || !image || !["image/png", "image/jpeg", "image/webp"].includes(image.mime))
      throw new Error("skins.error.images");
    images[asset.id] = {
      mime: image.mime as SkinPackage["images"][string]["mime"],
      data: Buffer.from(image.bytes).toString("base64"),
    };
  }
  const json = JSON.stringify({
    vibeskin: 1,
    name: skin.name,
    foundation: skin.foundation,
    definition: skin.definition,
    images,
  });
  if (Buffer.byteLength(json) > MAX_SKIN_PACKAGE_BYTES) throw new Error("skins.error.packageSize");
  return json;
}
export async function importSkin(json: string): Promise<Skin> {
  if (Buffer.byteLength(json) > MAX_SKIN_PACKAGE_BYTES) throw new Error("skins.error.packageSize");
  let data: SkinPackage;
  try {
    data = skinPackageSchema.parse(JSON.parse(json));
  } catch {
    throw new Error("skins.error.package");
  }
  // Validate the entire package before writing. IDs are derived from the bytes,
  // never trusted from the file, so importing cannot overwrite an existing image.
  const decoded = new Map<string, { id: string; bytes: Buffer; mime: string }>();
  for (const asset of Object.values(data.definition.assets ?? {})) {
    const image = asset.id ? data.images[asset.id] : undefined;
    if (!asset.id || !image) throw new Error("skins.error.package");
    if (decoded.has(asset.id)) continue;
    const bytes = Buffer.from(image.data, "base64");
    const signature =
      image.mime === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : image.mime === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!signature || bytes.toString("base64") !== image.data)
      throw new Error("skins.error.package");
    decoded.set(asset.id, {
      id: createHash("sha256").update(bytes).digest("hex").slice(0, 32),
      bytes,
      mime: image.mime,
    });
  }
  for (const asset of Object.values(data.definition.assets ?? {})) {
    const image = decoded.get(asset.id!)!;
    await putImage({ ...image, prompt: asset.prompt, model: "(skin import)" });
    asset.id = image.id;
  }
  return createSkin(data.name, undefined, {
    definition: data.definition,
    foundation: data.foundation,
  });
}
