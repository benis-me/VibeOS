import { cliEnv } from "./env.ts";

export interface CliStreamResult {
  code: number | null;
  /** Tail of stderr (capped), for error messages. */
  stderr: string;
}

/**
 * Spawn a CLI, write `stdin`, and stream its stdout as JSON Lines — calling
 * `onObject` for each parsed line. stderr is drained concurrently (capped) so a
 * chatty CLI can't deadlock on a full pipe, and surfaces as an error message.
 * Aborting kills the process. This is the one subprocess seam all CLI providers
 * share (replaces the vendor SDKs).
 */
export async function streamJsonl(opts: {
  bin: string;
  args: string[];
  stdin: string;
  abort?: AbortController;
  onObject: (obj: Record<string, unknown>) => void;
}): Promise<CliStreamResult> {
  const proc = Bun.spawn([opts.bin, ...opts.args], {
    stdin: new TextEncoder().encode(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
    // Strip the sandbox's broken NODE_OPTIONS so node-based CLIs (claude/
    // codebuddy) don't crash on startup; inherit everything else (auth, PATH).
    env: cliEnv() as Record<string, string>,
  });

  const onAbort = () => proc.kill();
  if (opts.abort?.signal.aborted) proc.kill();
  else opts.abort?.signal.addEventListener("abort", onAbort, { once: true });

  let stderr = "";
  const drainStderr = (async () => {
    const reader = proc.stderr.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (stderr.length < 4000) stderr += dec.decode(value, { stream: true });
    }
  })();

  try {
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          opts.onObject(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* non-JSON diagnostic line — ignore */
        }
      }
    }
    const last = buf.trim();
    if (last) {
      try {
        opts.onObject(JSON.parse(last) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  } finally {
    opts.abort?.signal.removeEventListener("abort", onAbort);
  }

  const code = await proc.exited;
  await drainStderr;
  return { code, stderr: stderr.trim().slice(-500) };
}
