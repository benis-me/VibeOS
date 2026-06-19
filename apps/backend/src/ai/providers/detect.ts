import { homedir } from "node:os";

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
