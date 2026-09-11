import { lstatSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { diskPath } from "../../files/disk.ts";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  applicationDefinitionSchema,
  MAX_APP_PACKAGE_BYTES,
  messageDataSchema,
  communicationCommandSchema,
  type ApplicationDefinition,
  type AppRuntime,
  RUNTIME_SCRIPT_TYPE,
  MAX_RUNTIME_SCRIPT,
  localActionSchema,
} from "@vibeos/shared/domain";
import { stripEmoji } from "@vibeos/shared/util";
import { getApp, installApp } from "./AppRepo.ts";
import { getAppData, readApplicationVersion } from "./ApplicationRepo.ts";
import { getImage, putImage } from "./ImagesRepo.ts";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";
import { ensureShortcut } from "./VfsRepo.ts";
import { writeContent } from "../../files/content.ts";
import { parseSubscriptions } from "./CommunicationRepo.ts";

const raster = z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
const imageSchema = z
  .object({ mime: raster, data: z.string().max(MAX_APP_PACKAGE_BYTES) })
  .strict();
const packageSchema = z
  .object({
    vibeapp: z.union([z.literal(2), z.literal(3)]),
    name: z.string().trim().min(1).max(100),
    icon: z.string().max(100),
    definition: applicationDefinitionSchema,
    images: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), imageSchema),
    data: messageDataSchema.optional(),
  })
  .strict();

export async function validateRuntimeScripts(html: string, runtime: AppRuntime = "html") {
  const ids = new Set<string>();
  let total = 0,
    closed = 0,
    body = "";
  await new HTMLRewriter()
    .on("script", {
      element(element) {
        const id = element.getAttribute("data-vibeos-script") ?? "";
        if (
          runtime !== "interactive" ||
          element.getAttribute("type") !== RUNTIME_SCRIPT_TYPE ||
          element.hasAttribute("src") ||
          !/^[a-zA-Z][\w-]{0,79}$/.test(id) ||
          ids.has(id) ||
          ids.size >= 8
        )
          throw new Error("runtime.error.script", {
            cause: `Expected <script type="${RUNTIME_SCRIPT_TYPE}" data-vibeos-script="unique-stable-id"> with no src; received type=${element.getAttribute("type")}, id=${id}, runtime=${runtime}`,
          });
        ids.add(id);
        body = "";
        element.onEndTag(() => {
          closed++;
          // Compile for syntax validation ONLY. Generated code never runs in Bun.
          try {
            new Function("vibe", "root", body);
          } catch (cause) {
            throw new Error("runtime.error.script", { cause });
          }
        });
      },
      text(chunk) {
        body += chunk.text;
        total += Buffer.byteLength(chunk.text);
        if (total > MAX_RUNTIME_SCRIPT) throw new Error("runtime.error.script");
      },
    })
    .transform(new Response(html))
    .text();
  if (closed !== ids.size)
    throw new Error("runtime.error.script", {
      cause: "Missing closing script tag",
    });
}

export async function validateApplicationHtml(
  html: string,
  runtime: AppRuntime = "html",
): Promise<void> {
  await validateRuntimeScripts(html, runtime);
  let invalid = false;
  const rewriter = new HTMLRewriter().on("*", {
    element(element) {
      if (
        ["iframe", "object", "embed", "base", "link"].includes(element.tagName) ||
        (element.tagName === "meta" &&
          (!/^utf-?8$/i.test(element.getAttribute("charset") ?? "") ||
            [...element.attributes].some(([name]) => name !== "charset")))
      )
        invalid = true;
      for (const [name, value] of element.attributes) {
        if (name.startsWith("on") || /(?:javascript|vbscript):/i.test(value)) invalid = true;
        if (name === "data-vibeos-command") communicationCommandSchema.parse(JSON.parse(value));
        if (name === "data-vibeos-local") localActionSchema.parse(JSON.parse(value));
      }
    },
  });
  await rewriter.transform(new Response(html)).text();
  if (invalid) throw new Error("applications.error.html");
  await parseSubscriptions(html);
}

function imageIds(definition: ApplicationDefinition): string[] {
  return [
    ...new Set([
      ...Object.values(definition.assets),
      ...Array.from(definition.seedHtml.matchAll(/\/api\/img\/([a-zA-Z0-9_-]+)/g), (m) => m[1]!),
    ]),
  ];
}

export function persistApplicationAssets(
  definition: ApplicationDefinition,
  directory: string,
  required: boolean,
) {
  const assets: Record<string, { mime: string; file: string }> = {};
  for (const id of imageIds(definition)) {
    const image = getImage(id);
    if (!image) {
      if (required) throw new Error("applications.error.asset");
      continue;
    }
    const file = `Assets/${id}.${image.mime.split("/")[1] ?? "bin"}`;
    writeContent(`${directory}/${file}`, image.bytes, true);
    assets[id] = { mime: image.mime, file };
  }
  writeContent(`${directory}/assets.json`, JSON.stringify(assets, null, 2), true);
}

export function exportApplication(appId: string, includeData = false): string {
  const app = getApp(appId);
  if (!app || app.kind !== "virtual") throw new Error("applications.error.readOnly");
  const definition = readApplicationVersion(appId)!;
  const row = getDb()
    .query<
      { legacy: number },
      [string]
    >("SELECT legacy FROM app_versions WHERE id=(SELECT active_version_id FROM apps WHERE id=?)")
    .get(appId);
  // Old snapshots may literally contain a user's records. Export the generation
  // intent; an imported legacy application generates a fresh UI on first open.
  if (row?.legacy && !includeData) definition.seedHtml = "";
  const images: Record<string, { mime: z.infer<typeof raster>; data: string }> = {};
  for (const id of imageIds(definition)) {
    const image = getImage(id);
    if (!image || !raster.safeParse(image.mime).success)
      throw new Error("applications.error.asset");
    images[id] = {
      mime: image.mime as z.infer<typeof raster>,
      data: Buffer.from(image.bytes).toString("base64"),
    };
  }
  const json = JSON.stringify(
    {
      vibeapp: definition.runtime === "interactive" ? 3 : 2,
      name: app.name,
      icon: app.icon,
      definition:
        definition.runtime === "html"
          ? Object.fromEntries(Object.entries(definition).filter(([key]) => key !== "runtime"))
          : definition,
      images,
      ...(includeData ? { data: getAppData(appId).data } : {}),
    },
    null,
    2,
  );
  if (Buffer.byteLength(json) > MAX_APP_PACKAGE_BYTES)
    throw new Error("applications.error.packageSize");
  return json;
}

function decodeImage(mime: string, encoded: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error("applications.error.asset");
  const b = Buffer.from(encoded, "base64");
  const valid =
    mime === "image/png"
      ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/jpeg"
        ? b[0] === 255 && b[1] === 216 && b[2] === 255
        : mime === "image/webp"
          ? b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP"
          : mime === "image/gif"
            ? /^GIF8[79]a$/.test(b.subarray(0, 6).toString())
            : mime === "image/avif"
              ? b.subarray(4, 8).toString() === "ftyp" &&
                /avif|avis/.test(b.subarray(8, 32).toString())
              : false;
  if (!valid) throw new Error("applications.error.asset");
  return b;
}

export async function importApplication(json: string) {
  if (Buffer.byteLength(json) > MAX_APP_PACKAGE_BYTES)
    throw new Error("applications.error.packageSize");
  const raw = JSON.parse(json);
  if (raw?.vibeapp !== 2 && raw?.vibeapp !== 3) {
    const legacy = z
      .object({
        vibeapp: z.literal(1).optional(),
        name: z.string().trim().min(1).max(100),
        icon: z.string().max(100).optional(),
        manifest: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(raw);
    const manifest = legacy.manifest ?? {};
    const definition = applicationDefinitionSchema.parse({
      description: manifest.description ?? "",
      instructions: manifest.instructions ?? manifest.description ?? "",
      seedHtml: manifest.seedHtml ?? "",
      defaultSize: manifest.defaultSize,
      fileTypes: manifest.fileTypes ?? [],
      operations: manifest.operations ?? [],
    });
    await validateApplicationHtml(definition.seedHtml);
    const app = await installApp({
      name: legacy.name,
      icon: legacy.icon,
      manifest: definition,
    });
    await ensureShortcut(app.id, app.name, app.icon);
    return app;
  }
  const input = packageSchema.parse(raw);
  if (input.vibeapp === 2 && input.definition.runtime !== "html")
    throw new Error("applications.error.package");
  await validateApplicationHtml(input.definition.seedHtml, input.definition.runtime);
  if (imageIds(input.definition).some((id) => !Object.hasOwn(input.images, id)))
    throw new Error("applications.error.asset");
  const decoded = Object.entries(input.images).map(([id, image]) => ({
    old: id,
    mime: image.mime,
    bytes: decodeImage(image.mime, image.data),
  }));
  // All validation and decoding above precede ANY writes.
  const name = stripEmoji(input.name).trim();
  if (!name) throw new Error("applications.error.name");
  const mapping = Object.fromEntries(
    decoded.map((image) => [
      image.old,
      createHash("sha256").update(image.bytes).digest("hex").slice(0, 32),
    ]),
  );
  const safe = applicationDefinitionSchema.parse({
    ...input.definition,
    assets: Object.fromEntries(
      Object.entries(input.definition.assets).map(([key, id]) => [key, mapping[id] ?? id]),
    ),
    seedHtml: input.definition.seedHtml.replace(
      /\/api\/img\/([a-zA-Z0-9_-]+)/g,
      (_, id) => `/api/img/${mapping[id] ?? id}`,
    ),
  });
  for (const image of decoded)
    await putImage({
      id: mapping[image.old]!,
      mime: image.mime,
      bytes: image.bytes,
      prompt: "Imported application asset",
      model: "import",
    });
  const app = await installApp({ name, icon: input.icon, manifest: safe });
  await enqueue(() => {
    getDb().query("UPDATE app_versions SET legacy=0 WHERE app_id=?").run(app.id);
    writeContent(
      `System/AppData/${encodeURIComponent(app.id)}/state.json`,
      JSON.stringify({ schemaVersion: safe.dataSchemaVersion, data: input.data ?? {} }, null, 2),
    );
  });
  await ensureShortcut(app.id, app.name, app.icon);
  return getApp(app.id)!;
}

/** Import only the active definition and referenced raster bytes. */
export async function importApplicationDirectory(path: string) {
  let total = 0;
  const read = (relative: string) => {
    const absolute = diskPath(`${path}/${relative}`);
    const stat = lstatSync(absolute);
    total += stat.size;
    if (!stat.isFile() || total > MAX_APP_PACKAGE_BYTES)
      throw new Error("applications.error.packageSize");
    return readFileSync(absolute);
  };
  const manifest = JSON.parse(read("manifest.json").toString("utf8"));
  if (manifest.format !== 2 || !/^Versions\/[a-zA-Z0-9_-]+\/index\.html$/.test(manifest.entry))
    throw new Error("applications.error.package");
  const root = dirname(manifest.entry);
  const definition = applicationDefinitionSchema.parse({
    ...JSON.parse(read(`${root}/definition.json`).toString("utf8")),
    seedHtml: read(manifest.entry).toString("utf8"),
  });
  const assets = JSON.parse(read(`${root}/assets.json`).toString("utf8"));
  const images: Record<string, { mime: string; data: string }> = {};
  for (const id of imageIds(definition)) {
    const asset = assets[id];
    if (!asset || !/^Assets\/[a-zA-Z0-9_.-]+$/.test(asset.file))
      throw new Error("applications.error.asset");
    images[id] = {
      mime: asset.mime,
      data: read(`${root}/${asset.file}`).toString("base64"),
    };
  }
  return importApplication(
    JSON.stringify({
      vibeapp: definition.runtime === "interactive" ? 3 : 2,
      name: manifest.name,
      icon: manifest.icon,
      definition,
      images,
    }),
  );
}
