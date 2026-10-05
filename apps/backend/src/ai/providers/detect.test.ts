import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newestBinary } from "./detect.ts";

const root = mkdtempSync(join(tmpdir(), "vibeos-detect-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A CLI install in its own directory whose `--version` prints `version`. */
function install(dir: string, bin: string, version: string): string {
  mkdirSync(join(root, dir), { recursive: true });
  const path = join(root, dir, bin);
  writeFileSync(path, `#!/bin/sh\necho "${version}"\n`);
  chmodSync(path, 0o755);
  return path;
}

test("a newer install later on PATH replaces a stale one, never a wrapper", async () => {
  install("stale", "vibeos-old", "codex-cli 0.154.0");
  const fresh = install("fresh", "vibeos-old", "codex-cli 0.160.0");
  const wrapper = install("stale", "vibeos-wrapped", "{}");
  install("fresh", "vibeos-wrapped", "codex-cli 0.160.0");
  const path = process.env.PATH;
  process.env.PATH = `${join(root, "stale")}:${join(root, "fresh")}:${path}`;
  try {
    expect(await newestBinary("vibeos-old")).toBe(fresh);
    expect(await newestBinary("vibeos-wrapped")).toBe(wrapper);
  } finally {
    process.env.PATH = path;
  }
});
