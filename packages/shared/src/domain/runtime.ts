import { z } from "zod";
import { messageDataSchema } from "./communication.ts";

export const appRuntimeSchema = z.enum(["html", "interactive"]);
export type AppRuntime = z.infer<typeof appRuntimeSchema>;
export const viewStateSchema = z
  .record(z.string().max(100), messageDataSchema)
  .refine(
    (state) =>
      messageDataSchema.safeParse(state).success &&
      new TextEncoder().encode(JSON.stringify(state)).length <= 16384,
    "View state exceeds 16 KiB",
  );
export type ViewState = z.infer<typeof viewStateSchema>;
const target = z.string().regex(/^[a-zA-Z][\w-]{0,79}$/);
/** Prepared local UI has no writes or system side effects. Targets are inside one surface. */
export const localActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["show", "hide", "toggle"]), target }).strict(),
  z.object({ action: z.literal("select"), target, value: target }).strict(),
  z.object({ action: z.literal("filter"), target }).strict(),
  z
    .object({
      action: z.literal("sort"),
      target,
      direction: z.enum(["asc", "desc"]).default("asc"),
    })
    .strict(),
]);
export type LocalAction = z.infer<typeof localActionSchema>;
export const RUNTIME_SCRIPT_TYPE = "application/vibeos";
export const MAX_RUNTIME_SCRIPT = 65536;
