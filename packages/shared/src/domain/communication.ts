import { z } from "zod";

export const MESSAGE_BYTES = 256 * 1024;
export const MESSAGE_TIMEOUT = 120_000;
const id = z.string().min(1).max(100);
const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/);
const path = z.string().max(4096);
export type MessageData =
  null | boolean | number | string | MessageData[] | { [key: string]: MessageData };
// Bound the depth and byte size of user/model-supplied JSON.
export const messageDataSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const valid = (v: unknown, depth: number): boolean => {
      if (depth > 16) return false;
      if (v === null || typeof v === "string" || typeof v === "boolean") return true;
      if (typeof v === "number") return Number.isFinite(v);
      if (Array.isArray(v)) return v.every((x) => valid(x, depth + 1));
      return (
        typeof v === "object" &&
        v !== null &&
        Object.entries(v).every(
          ([k, x]) => !["__proto__", "constructor", "prototype"].includes(k) && valid(x, depth + 1),
        )
      );
    };
    try {
      if (
        !valid(value, 0) ||
        new TextEncoder().encode(JSON.stringify(value)).length > MESSAGE_BYTES
      )
        ctx.addIssue({ code: "custom", message: "Invalid or oversized message data" });
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid message data" });
    }
  })
  .transform((v) => v as MessageData);

export const messageTargetSchema = z.union([
  z.object({ windowId: id }).strict(),
  z.object({ appId: id, open: z.boolean().optional(), newWindow: z.boolean().optional() }).strict(),
  z.object({ system: z.enum(["files", "apps", "settings"]) }).strict(),
]);
export const subscriptionSchema = z
  .object({
    id: name,
    topic: name,
    source: z.union([
      z.object({ system: z.literal(true) }).strict(),
      z.object({ appId: id }).strict(),
    ]),
    path: path.optional(),
    mode: z.enum(["data", "ai"]).default("data"),
    channel: name.optional(),
    // A subscription can refresh real data without asking a model to redraw it.
    refresh: z
      .object({ action: z.enum(["read", "list", "stat"]), path })
      .strict()
      .optional(),
  })
  .strict()
  .refine((s) => !s.refresh || s.mode === "data", "Refresh is a data subscription");
export const subscriptionsSchema = z.array(subscriptionSchema).max(16);
export const communicationCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh") }).strict(),
  z
    .object({
      action: z.enum(["send", "request"]),
      target: messageTargetSchema,
      topic: name,
      data: messageDataSchema.optional(),
      mode: z.enum(["data", "ai"]).default("ai"),
      responseMode: z.enum(["data", "ai"]).default("data"),
      channel: name.optional(),
      timeoutMs: z.number().int().min(1000).max(180_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reply"),
      messageId: id,
      data: messageDataSchema.optional(),
      error: z.string().max(300).optional(),
    })
    .strict(),
  z.object({ action: z.literal("subscribe"), subscription: subscriptionSchema }).strict(),
  z.object({ action: z.literal("unsubscribe"), id: name }).strict(),
  z
    .object({ action: z.literal("publish"), topic: name, data: messageDataSchema.optional() })
    .strict(),
]);
export type CommunicationCommand = z.input<typeof communicationCommandSchema>;
export type AppSubscription = z.infer<typeof subscriptionSchema>;
export type MessageTarget = z.infer<typeof messageTargetSchema>;
export type MessageSource = { system: true } | { appId: string; windowId: string };
export interface MessageTrace {
  id: string;
  hops: number;
  windows: string[];
  requests?: string[];
}
export interface AppDelivery {
  id: string;
  windowId: string;
  source: MessageSource;
  kind: "request" | "message" | "response" | "event";
  topic: string;
  data: MessageData;
  mode: "data" | "ai";
  channel?: string;
  correlationId?: string;
  subscriptionId?: string;
  error?: string;
  expiresAt: number;
  trace: MessageTrace;
}
