import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("review regressions: real file watches, casing, memory provenance, maintenance and activity history", () => {
  const directory = mkdtempSync(join(tmpdir(), "vibeos-reliability-"));
  try {
    const result = Bun.spawnSync([process.execPath, "test/reliability.ts"], {
      cwd: new URL("../../../", import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        VIBEOS_DATA_DIR: directory,
        VIBEOS_DB_PATH: join(directory, "runtime/vibeos.db"),
        VIBEOS_AI_STUB: "0",
        VIBEOS_AGENTS_DISABLED: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    if (result.exitCode !== 0)
      throw new Error(
        new TextDecoder().decode(result.stderr) + new TextDecoder().decode(result.stdout),
      );
    expect(result.exitCode).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 25_000);
