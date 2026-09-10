import { z } from "zod";
import { messageDataSchema, type MessageData } from "./communication.ts";

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(100);
export const MAX_APP_PACKAGE_BYTES = 24 * 1024 * 1024;
export const applicationDefinitionSchema = z
  .object({
    description: z.string().max(4000).default(""),
    instructions: z.string().max(16000).default(""),
    seedHtml: z
      .string()
      .max(512 * 1024)
      .default(""),
    defaultSize: z
      .object({ w: z.number().int().min(240).max(2000), h: z.number().int().min(160).max(1400) })
      .optional(),
    fileTypes: z
      .array(z.string().regex(/^(\.[a-zA-Z0-9]+|[a-zA-Z0-9.+-]+\/(?:[a-zA-Z0-9.+-]+|\*))$/))
      .max(32)
      .default([]),
    operations: z
      .array(
        z
          .object({
            topic: z.string().regex(/^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/),
            description: z.string().max(500),
          })
          .strict(),
      )
      .max(32)
      .default([]),
    dataSchemaVersion: z.number().int().min(1).max(10000).default(1),
    assets: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), id).default({}),
  })
  .strict();
export type ApplicationDefinition = z.infer<typeof applicationDefinitionSchema>;
export const applicationOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(1000),
    definition: applicationDefinitionSchema,
    // Used only for an explicit legacy upgrade or a data-schema migration.
    migratedData: messageDataSchema.optional(),
  })
  .strict();
export const applicationCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state") }).strict(),
  z
    .object({ action: z.literal("create"), name, prompt: z.string().max(16000).optional() })
    .strict(),
  z.object({ action: z.literal("rename"), appId: id, name }).strict(),
  z.object({ action: z.literal("duplicate"), appId: id, name: name.optional() }).strict(),
  z.object({ action: z.enum(["uninstall", "clear-data"]), appId: id }).strict(),
  z.object({ action: z.literal("activate"), appId: id, versionId: id }).strict(),
  z
    .object({
      action: z.literal("generate"),
      appId: id,
      prompt: z.string().trim().min(1).max(16000),
      sourceWindowId: id.optional(),
    })
    .strict(),
  z.object({ action: z.literal("cancel"), requestId: id }).strict(),
  z.object({ action: z.literal("update-window"), windowId: id }).strict(),
  z
    .object({ action: z.literal("export"), appId: id, includeData: z.boolean().optional() })
    .strict(),
  z.object({ action: z.literal("import"), json: z.string().max(MAX_APP_PACKAGE_BYTES) }).strict(),
]);
export type ApplicationCommand = z.infer<typeof applicationCommandSchema>;
export interface ApplicationVersion {
  id: string;
  number: number;
  summary: string;
  createdAt: number;
  dataSchemaVersion: number;
  legacy: boolean;
}
export interface ApplicationRequest {
  id: string;
  appId: string;
  prompt: string;
  baseVersionId: string;
  status: "generating" | "validating" | "succeeded" | "failed" | "cancelled" | "interrupted";
  chars: number;
  summary: string;
  error?: string;
  versionId?: string;
  createdAt: number;
}
export interface ApplicationDetail {
  appId: string;
  path: string;
  activeVersionId: string;
  originAppId?: string;
  versions: ApplicationVersion[];
  requests: ApplicationRequest[];
}
export interface ApplicationState {
  applications: ApplicationDetail[];
}
export interface AppDataSnapshot {
  appId: string;
  version: string;
  schemaVersion: number;
  data: MessageData;
}
export const appDataWriteSchema = z
  .object({ version: z.string().length(64), data: messageDataSchema })
  .strict();
export function supportsFile(
  types: readonly string[] | undefined,
  path: string,
  mime?: string,
): boolean {
  if (!types?.length) return false;
  const lower = path.toLowerCase();
  return types.some((t) =>
    t.startsWith(".")
      ? lower.endsWith(t.toLowerCase())
      : t.endsWith("/*")
        ? mime?.startsWith(t.slice(0, -1))
        : mime === t,
  );
}
