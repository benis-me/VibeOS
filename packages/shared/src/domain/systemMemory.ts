import { z } from "zod";

export interface SystemMemory {
  id: string;
  content: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}
export interface SystemMemoryState {
  enabled: boolean;
  revision: number;
  entries: SystemMemory[];
}
export const memoryCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state") }).strict(),
  z.object({ action: z.literal("toggle"), enabled: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("save"),
      id: z.string().min(1).optional(),
      content: z.string().trim().min(1).max(1500),
    })
    .strict(),
  z.object({ action: z.literal("remove"), id: z.string().min(1) }).strict(),
  z.object({ action: z.literal("clear") }).strict(),
]);
export type MemoryCommand = z.infer<typeof memoryCommandSchema>;
export const memoryExtractionSchema = z
  .object({
    save: z
      .array(
        z
          .object({ id: z.string().optional(), content: z.string().trim().min(1).max(1500) })
          .strict(),
      )
      .max(5),
    remove: z.array(z.string()).max(20),
  })
  .strict();
