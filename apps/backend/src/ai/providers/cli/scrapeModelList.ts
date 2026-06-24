import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../detect.ts";
import { cliEnv } from "./env.ts";
import type { DiscoveredModel } from "../types.ts";
import { logger } from "../../../util/log.ts";

const log = logger("provider:cli:scrape");

/**
 * CodeBuddy hides its account model list behind the interactive `/model list`
 * TUI command — there is no headless flag, subcommand, or local HTTP route for
 * it (print mode treats the slash command as a prompt). The only way to read it
 * programmatically is to drive a real PTY. We shell out to `expect`, which gives
 * us the pseudo-terminal `Bun.spawn` can't, type `/model list`, and scrape the
 * rendered screen.
 *
 * This is deliberately slow (~35s: session boot + render) and only ever runs
 * when the user explicitly clicks "Fetch models" — never on boot or scan. The
 * pre-seeded catalog (settings.AI_PROVIDERS seedModels) covers the default case.
 *
 * NOTE: the Enter key is sent SEPARATELY from the command text — an inline `\r`
 * gets swallowed by CodeBuddy's slash-command autocomplete menu.
 */
const EXPECT_SCRIPT = (cbBin: string) => `
set stty_init "rows 70 columns 220"
log_user 1
spawn ${cbBin}
set timeout 14
expect { timeout {} eof {} }
send "/model list"
set timeout 3
expect { timeout {} eof {} }
send "\\r"
set timeout 8
expect { timeout {} eof {} }
send "\\r"
set timeout 8
expect { timeout {} eof {} }
send "\\003"
set timeout 2
expect { timeout {} eof {} }
send "\\003"
set timeout 2
expect { timeout {} eof {} }
exit 0
`;

/** Drive `<bin>`'s interactive `/model list` via a PTY and parse the result. */
export async function scrapeModelList(bin: string): Promise<DiscoveredModel[]> {
  const expectBin = whichBinary("expect");
  const cbBin = whichBinary(bin);
  if (!expectBin || !cbBin) {
    log.warn(`PTY model scrape unavailable (expect=${!!expectBin}, ${bin}=${!!cbBin})`);
    return [];
  }

  const scriptPath = join(tmpdir(), "vibeos-cli-models.exp");
  await Bun.write(scriptPath, EXPECT_SCRIPT(cbBin));

  const proc = Bun.spawn([expectBin, scriptPath], {
    stdout: "pipe",
    stderr: "ignore",
    env: cliEnv() as Record<string, string>,
  });
  // Safety net: the script self-exits in ~37s, but never let it hang the server.
  const kill = setTimeout(() => proc.kill(), 60_000);
  try {
    const raw = await new Response(proc.stdout).text();
    await proc.exited;
    const models = parseModelList(raw);
    log.info(`PTY scrape of ${bin} /model list → ${models.length} model(s)`);
    return models;
  } catch (e) {
    log.warn(`PTY model scrape failed: ${e instanceof Error ? e.message : e}`);
    return [];
  } finally {
    clearTimeout(kill);
  }
}

/** Parse `- Display-Name (model-id) [current]` lines out of the rendered screen. */
function parseModelList(raw: string): DiscoveredModel[] {
  // Stripping raw terminal output requires matching escape/control bytes.
  // biome-ignore-start lint/suspicious/noControlCharactersInRegex: de-ANSI a PTY capture
  const text = raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "") // CSI escapes
    .replace(/\x1b\][^\x07]*\x07/g, "") // OSC sequences
    .replace(/\x1b[()][AB0]/g, "") // charset selects
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0e-\x1f]/g, "");
  // biome-ignore-end lint/suspicious/noControlCharactersInRegex: de-ANSI a PTY capture
  const seen = new Map<string, DiscoveredModel>();
  for (const line of text.split("\n")) {
    // e.g. "  - Claude-Opus-4.8-1M (claude-opus-4.8-1m) current" — ignore any
    // trailing marker/padding after the id so the highlighted current row parses.
    const m = /^\s*[-*]\s*(.+?)\s*\(([a-z0-9][a-z0-9._-]*)\)/i.exec(line);
    if (!m) continue;
    const id = m[2]!.trim();
    if (!seen.has(id)) seen.set(id, { modelId: id, name: m[1]!.trim() });
  }
  return [...seen.values()];
}
