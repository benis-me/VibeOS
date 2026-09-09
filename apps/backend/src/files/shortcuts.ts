import { lstatSync, readFileSync } from "node:fs";
import { z } from "zod";

const shortcut = z.object({
  vibelink: z.literal(1),
  appId: z.string().min(1).max(200),
  icon: z.string().max(100).optional(),
});

/** A passive app reference, never an OS symlink or an executable command. */
export function readShortcut(absolute: string) {
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.size > 16 * 1024) throw new Error("shortcut");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    throw new Error("shortcut");
  }
  const parsed = shortcut.safeParse(value);
  if (!parsed.success) throw new Error("shortcut");
  return parsed.data;
}
