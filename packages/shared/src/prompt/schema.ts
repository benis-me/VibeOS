import { z } from "zod";

/** Zod schemas validating the AI's structured output (the syscall block). */

export const notificationKindSchema = z.enum(["info", "success", "warning", "error"]);

export const vfsLocationSchema = z.enum(["desktop", "folder", "recyclebin"]);

export const syscallSchema = z.discriminatedUnion("type", [
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
    appId: z.string().min(1).optional(),
    width: z.number().min(240).max(2000).optional(),
    height: z.number().min(160).max(1400).optional(),
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
    windowId: z.string().min(1),
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
  /** Full HTML body (mode 'full'). */
  html?: string;
  /** Region replacements (mode 'regions'). */
  regions?: { region: string; html: string }[];
  syscalls: z.infer<typeof syscallSchema>[];
  summary: string;
}
