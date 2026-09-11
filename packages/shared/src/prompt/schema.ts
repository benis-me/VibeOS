import { z } from "zod";
import { communicationCommandSchema, messageDataSchema } from "../domain/communication.ts";
import { windowSizeSchema } from "../protocol/schema.ts";

/** Zod schemas validating the AI's structured output (the syscall block). */

export const notificationKindSchema = z.enum(["info", "success", "warning", "error"]);

export const vfsLocationSchema = z.enum(["desktop", "folder", "recyclebin"]);

export const syscallSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("app-state"), data: messageDataSchema.optional() }).strict(),
  z.object({ type: z.literal("communication"), command: communicationCommandSchema }),
  z.object({ type: z.literal("resize-window"), size: windowSizeSchema }),
  z
    .object({
      type: z.literal("window-state"),
      state: z.enum(["normal", "minimized", "maximized"]),
      windowIds: z.union([z.literal("all"), z.array(z.string().min(1)).min(1).max(128)]),
    })
    .strict(),
  z.object({
    type: z.literal("notify"),
    title: z.string().min(1).max(120),
    body: z.string().max(500).optional(),
    kind: notificationKindSchema.optional(),
  }),
  z.object({
    type: z.literal("open"),
    appId: z.string().min(1),
  }),
  z.object({
    type: z.literal("spawn-window"),
    title: z.string().min(1).max(80),
    prompt: z.string().min(1).max(2000),
    context: messageDataSchema.optional(),
    appId: z.string().min(1).optional(),
    width: windowSizeSchema.shape.w.optional(),
    height: windowSizeSchema.shape.h.optional(),
  }),
  z.object({
    type: z.literal("install"),
    name: z.string().min(1).max(60),
    icon: z.string().max(60).optional(),
    manifest: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("create-file"),
    name: z.string().min(1).max(120),
    mime: z.string().max(120).optional(),
    content: z.string().max(20000).optional(),
    location: vfsLocationSchema.optional(),
  }),
  z.object({
    type: z.literal("focus"),
    windowId: z.string().min(1),
  }),
  z.object({
    type: z.literal("close"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("chrome"),
    set: z.record(z.string(), z.string()),
  }),
]);

export const syscallBatchSchema = z.object({
  calls: z.array(syscallSchema).max(8).default([]),
});

export type ParsedSyscallBatch = z.infer<typeof syscallBatchSchema>;

/** The fully parsed AI output. */
export interface ParsedAiOutput {
  renderError?: string;
  syscallError?: string;
  /** Full HTML body (mode 'full'). */
  html?: string;
  /** Region replacements (mode 'regions'). */
  regions?: { region: string; html: string }[];
  syscalls: z.infer<typeof syscallSchema>[];
  summary: string;
}
