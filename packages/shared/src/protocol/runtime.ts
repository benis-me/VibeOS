import { z } from "zod";
import { communicationCommandSchema } from "../domain/communication.ts";
import { viewStateSchema } from "../domain/runtime.ts";
import { aiOpSchema } from "./schema.ts";

/** The parent supplies window/app identity; an iframe cannot choose it. */
export const runtimeMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("op"), op: aiOpSchema }).strict(),
  z
    .object({
      type: z.literal("command"),
      id: z.string().max(100),
      command: communicationCommandSchema,
    })
    .strict(),
  z.object({ type: z.literal("view"), state: viewStateSchema }).strict(),
  z.object({ type: z.literal("focus") }).strict(),
  z
    .object({
      type: z.literal("context"),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal("shortcut"),
      key: z.enum(["k", " "]),
      ctrl: z.boolean(),
      meta: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("drop"),
      source: z.object({
        kind: z.enum(["text", "image", "file", "desktop-object", "app-shortcut"]),
        ref: z.string().max(16384),
        label: z.string().max(500).optional(),
      }),
    })
    .strict(),
  z.object({ type: z.literal("error"), message: z.string().max(1000) }).strict(),
]);
export type RuntimeMessage = z.infer<typeof runtimeMessageSchema>;
