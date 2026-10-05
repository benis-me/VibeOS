import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { cliEnv } from "./cli/env.ts";

/**
 * PATH augmented with well-known toolchain dirs. A backend not launched from a
 * login shell often has a minimal PATH and would miss CLIs the user clearly has
 * (e.g. `~/.local/bin/claude`). (Adapted from Omakase2 `runtimes/executables.ts`
 * `wellKnownToolchainDirs`.)
 */
function augmentedPath(): string {
  const home = homedir();
  const extra = [
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.deno/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.cargo/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  return [process.env.PATH ?? "", ...extra].filter(Boolean).join(":");
}

/** Resolve a CLI binary across PATH + well-known dirs (null if not installed). */
export function whichBinary(bin: string): string | null {
  return Bun.which(bin, { PATH: augmentedPath() });
}

const newest = new Map<string, { at: number; path: Promise<string | null> }>();

/**
 * The newest install of a CLI across PATH + well-known dirs. The first one on
 * PATH can be a stale global install (an old npm prefix), and Codex only offers
 * an old client the models it supports. A first entry that reports no version
 * (a wrapper script or test double) is kept as the user's choice. Rechecked
 * every five minutes so an upgrade is picked up without a restart.
 */
export function newestBinary(bin: string): Promise<string | null> {
  const hit = newest.get(bin);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.path;
  const path = pickNewest(bin);
  newest.set(bin, { at: Date.now(), path });
  return path;
}

async function pickNewest(bin: string): Promise<string | null> {
  const found = new Map<string, string>(); // real path → first PATH entry reaching it
  for (const dir of augmentedPath().split(":")) {
    const path = Bun.which(bin, { PATH: dir });
    if (path && !found.has(realpathSync(path))) found.set(realpathSync(path), path);
  }
  const paths = [...found.values()];
  if (paths.length < 2) return paths[0] ?? null;
  const versions = await Promise.all(paths.map(version));
  let best = 0;
  for (let i = 1; i < paths.length && versions[0]!.length; i++) {
    if (newer(versions[i]!, versions[best]!)) best = i;
  }
  return paths[best]!;
}

/** `--version` as [major, minor, patch]; [] when it can't be read. */
async function version(path: string): Promise<number[]> {
  try {
    const proc = Bun.spawn([path, "--version"], {
      stdout: "pipe",
      stderr: "ignore",
      env: cliEnv() as Record<string, string>,
    });
    const kill = setTimeout(() => proc.kill(), 5000);
    const text = await new Response(proc.stdout).text();
    clearTimeout(kill);
    return (/(\d+)\.(\d+)\.(\d+)/.exec(text)?.slice(1) ?? []).map(Number);
  } catch {
    return [];
  }
}

function newer(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d > 0;
  }
  return false;
}
