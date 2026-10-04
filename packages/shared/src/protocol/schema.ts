import { applicationCommandSchema } from "../domain/applications.ts";
import { viewStateSchema } from "../domain/runtime.ts";
import { memoryCommandSchema } from "../domain/systemMemory.ts";
import { skinCommandSchema, skinIdSchema } from "../domain/skins.ts";
import { AI_PROVIDERS, type ProviderId } from "../domain/settings.ts";
import { communicationCommandSchema } from "../domain/communication.ts";
import { z } from "zod";
import type { ClientToServer } from "./client-to-server.ts";
import { FILE_UPLOAD_LIMIT } from "../domain/files.ts";
import { activityFilterSchema, agentRoleSchema } from "../domain/agent.ts";

/**
 * Runtime validation for inbound client→server messages. The WS boundary is the
 * one place untrusted input enters the backend, so every frame is parsed here
 * before dispatch; malformed payloads are rejected instead of crashing a handler.
 */

export const aiOpSchema = z.object({
  viewState: viewStateSchema.optional(),
  id: z.string().max(100).optional(),
  kind: z.enum(["click", "input", "submit", "change", "key", "custom"]),
  action: z.string().optional(),
  sel: z.string().optional(),
  dataset: z.record(z.string(), z.string()).optional(),
  value: z.string().optional(),
  formData: z.record(z.string(), z.string()).optional(),
  userInput: z
    .array(z.object({ key: z.string(), type: z.string(), value: z.string() }))
    .max(256)
    .optional(),
  regionPath: z.array(z.string()).optional(),
});

const dragPayload = z.object({
  kind: z.enum(["text", "image", "file", "desktop-object", "app-shortcut"]),
  ref: z.string(),
  label: z.string().optional(),
});

const dropTarget = z.object({
  windowId: z.string().optional(),
  action: z.string().optional(),
  sel: z.string().optional(),
});

const empty = z.object({});
const filePath = z.string().max(4096);
export const diskCommandSchema = z.union([
  z.object({
    action: z.enum([
      "list",
      "stat",
      "read",
      "mkdir",
      "trash",
      "restore",
      "delete",
      "open",
      "reveal",
    ]),
    path: filePath,
  }),
  z.object({ action: z.enum(["move", "copy"]), path: filePath, destination: filePath }),
  z.object({
    action: z.literal("write"),
    path: filePath,
    content: z.string().max(Math.ceil(FILE_UPLOAD_LIMIT / 3) * 4),
    encoding: z.literal("base64").optional(),
    version: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
]);

/** Same supported dimensions as AI-spawned windows. */
export const windowSizeSchema = z.object({
  w: z.number().int().min(240).max(2000),
  h: z.number().int().min(160).max(1400),
});

const providerIdSchema = z.enum(AI_PROVIDERS.map((p) => p.id) as [ProviderId, ...ProviderId[]]);
const roleConfigSchema = z
  .object({
    provider: z.string().max(80),
    model: z.string().max(300),
    effort: z.enum(["low", "medium", "high", "xhigh"]),
    thinking: z.enum(["disabled", "adaptive", "enabled"]),
    thinkingBudget: z.number().int().min(0).max(1_000_000),
  })
  .partial()
  .strict();
/** What Settings may change; a malformed or unknown field never reaches stored settings. */
export const settingsPartialSchema = z
  .object({
    theme: z.enum(["light", "dark"]),
    skin: skinIdSchema,
    provider: providerIdSchema,
    locale: z.enum(["zh", "en"]),
    modelOverrides: z.partialRecord(agentRoleSchema, roleConfigSchema),
    apiProviders: z.partialRecord(
      providerIdSchema,
      z
        .object({
          enabled: z.boolean(),
          apiKey: z.string().max(4096),
          baseUrl: z.string().max(2048),
          models: z
            .array(
              z
                .object({
                  id: z.string().min(1).max(300),
                  name: z.string().max(300),
                  capabilities: z
                    .array(z.enum(["text", "vision", "image", "reasoning", "tools"]))
                    .optional(),
                  enabled: z.boolean().optional(),
                })
                .strict(),
            )
            .max(1000),
          extra: z.record(z.string().max(100), z.string().max(2048)),
        })
        .partial()
        .strict(),
    ),
    prefs: z
      .object({
        memoryEnabled: z.boolean(),
        proactiveAgents: z.boolean(),
        wallpaper: z.string().max(2048),
        imageModel: z
          .object({ provider: z.string().max(80), model: z.string().max(300) })
          .partial()
          .strict(),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

/** Build a `{ type: <literal>, payload }` message schema, preserving the literal. */
const msg = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  z.object({ type: z.literal(type), payload });

export const clientToServerSchema = z.discriminatedUnion("type", [
  msg(
    "c2s.window.view-state",
    z
      .object({
        windowId: z.string().min(1).max(100),
        appVersionId: z.string().max(100).optional(),
        state: viewStateSchema,
      })
      .strict(),
  ),
  msg(
    "c2s.application.command",
    z.object({ requestId: z.string().min(1).max(100), command: applicationCommandSchema }),
  ),
  msg(
    "c2s.memory.command",
    z.object({ requestId: z.string().min(1).max(100), command: memoryCommandSchema }),
  ),
  msg(
    "c2s.communication.command",
    z.object({
      windowId: z.string().min(1).max(100),
      requestId: z.string().min(1).max(100),
      command: communicationCommandSchema,
    }),
  ),
  msg(
    "c2s.skin.command",
    z.object({ requestId: z.string().min(1).max(100), command: skinCommandSchema }),
  ),
  msg(
    "c2s.files.request",
    z.object({ requestId: z.string().min(1).max(100), command: diskCommandSchema }),
  ),
  msg("c2s.boot.hello", z.object({ clientId: z.string().optional() })),
  msg("c2s.op", z.object({ windowId: z.string(), op: aiOpSchema })),
  msg(
    "c2s.op.dragdrop",
    z.object({ windowId: z.string().optional(), source: dragPayload, target: dropTarget }),
  ),
  msg("c2s.window.open", z.object({ appId: z.string(), hint: z.string().optional() })),
  msg("c2s.window.close", z.object({ windowId: z.string() })),
  msg("c2s.window.reopen", z.object({ windowId: z.string() })),
  msg("c2s.window.cancel", z.object({ windowId: z.string() })),
  msg("c2s.window.focus", z.object({ windowId: z.string() })),
  msg("c2s.window.minimize", z.object({ windowId: z.string() })),
  msg("c2s.window.maximize", z.object({ windowId: z.string() })),
  msg(
    "c2s.window.move",
    z.object({ windowId: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  ),
  msg("c2s.window.reorder", z.object({ ids: z.array(z.string()) })),
  msg(
    "c2s.vfs.move",
    z.object({
      nodeId: z.string(),
      location: z.enum(["desktop", "folder", "recyclebin"]),
      x: z.number().optional(),
      y: z.number().optional(),
      parentId: z.string().optional(),
    }),
  ),
  msg("c2s.vfs.open", z.object({ nodeId: z.string() })),
  // Profile changes use validated, per-entry intents below, never a stale list replacement.
  msg("c2s.settings.update", z.object({ partial: settingsPartialSchema })),
  msg(
    "c2s.profile.update",
    z.discriminatedUnion("action", [
      z.object({
        action: z.literal("save"),
        id: z.string().min(1).optional(),
        content: z.string().trim().min(1),
      }),
      z.object({ action: z.literal("toggle"), id: z.string().min(1), enabled: z.boolean() }),
      z.object({ action: z.literal("remove"), id: z.string().min(1) }),
      z.object({ action: z.literal("disable-all") }),
    ]),
  ),
  msg("c2s.wallpaper.upload", z.object({ dataUrl: z.string() })),
  msg("c2s.wallpaper.generate", z.object({ prompt: z.string() })),
  msg("c2s.provider.fetchModels", z.object({ providerId: z.string() })),
  msg("c2s.notification.read", z.object({ id: z.string() })),
  msg("c2s.notification.click", z.object({ id: z.string() })),
  msg("c2s.app.search", z.object({ query: z.string(), requestId: z.string() })),
  msg(
    "c2s.app.launch",
    z.object({
      name: z.string(),
      description: z.string().optional(),
      icon: z.string().optional(),
      widget: z.boolean().optional(),
      size: windowSizeSchema.optional(),
    }),
  ),
  msg(
    "c2s.app.save",
    z.object({ windowId: z.string(), name: z.string().optional(), icon: z.string().optional() }),
  ),
  msg("c2s.app.export", z.object({ appId: z.string() })),
  msg(
    "c2s.activity.fetch",
    z.object({
      before: z.number().int().nonnegative().optional(),
      beforeId: z.string().max(100).optional(),
      limit: z.number().int().positive().optional(),
      filter: activityFilterSchema.optional(),
      requestId: z.string().max(100).optional(),
    }),
  ),
  msg(
    "c2s.activity.details",
    z.object({ runId: z.string().max(100), requestId: z.string().max(100) }),
  ),
  msg("c2s.activity.stop", z.object({ runId: z.string() })),
  msg("c2s.command.run", z.object({ text: z.string(), requestId: z.string() })),
]);

/** Validate an inbound `{ type, payload }`; returns the typed message or null. */
export function parseClientMessage(input: unknown): ClientToServer | null {
  const r = clientToServerSchema.safeParse(input);
  return r.success ? (r.data as ClientToServer) : null;
}
