import { tmpdir } from "node:os";
import type { Effort } from "@vibeos/shared/domain";
import type { AiProvider, DiscoveredModel, ProviderRunOptions, RunResult, TokenUsage } from "./types.ts";
import { whichBinary } from "./detect.ts";
import { streamJsonl } from "./cli/exec.ts";
import { logger } from "../../util/log.ts";

const log = logger("provider:codex");

/**
 * Codex is a coding *agent* (it wants to use tools, read files, plan). For
 * VibeOS it must behave as a one-shot text generator, so we lead with a forceful
 * instruction to skip all agentic behavior and just emit the response.
 */
const CODEX_PREAMBLE =
  "CRITICAL: This is NOT a coding task. Do NOT use any tools. Do NOT read, write, " +
  "search, or list files. Do NOT explore the workspace, run commands, or make a plan. " +
  "Respond in your FIRST and ONLY message with exactly the output described below and " +
  "nothing else.";

interface CodexDebugModel {
  slug?: string;
  display_name?: string;
  description?: string;
  visibility?: string;
}

interface MapState {
  text: string;
  sessionId?: string;
  error?: string;
  usage?: TokenUsage;
  curId: string;
  curStreamed: number;
}

/**
 * Codex — drives the `codex exec --json` CLI directly (no SDK). Codex has no
 * system-prompt flag, so the OS system prompt is prepended to the user prompt.
 * Pinned to a read-only sandbox in a scratch dir so it just returns the
 * assistant message. Resumes via `codex exec resume <thread-id>`.
 */
class CodexProvider implements AiProvider {
  readonly id = "codex" as const;
  readonly label = "Codex";

  async run(opts: ProviderRunOptions): Promise<RunResult> {
    const bin = whichBinary("codex");
    if (!bin) return { text: "", ok: false, error: "codex CLI not found on PATH" };

    const flags = ["--json", "--skip-git-repo-check", "--sandbox", "read-only", "--cd", tmpdir()];
    if (opts.model) flags.push("-m", opts.model);
    const effort = mapEffort(opts.effort);
    if (effort) flags.push("-c", `model_reasoning_effort="${effort}"`);

    const args = opts.sessionId
      ? ["exec", "resume", opts.sessionId, ...flags]
      : ["exec", ...flags];
    // No system-prompt flag in Codex → prepend it (with the anti-agent preamble)
    // to the prompt.
    const stdin = `${CODEX_PREAMBLE}\n\n${opts.systemPrompt}\n\n${opts.prompt}`;

    const state: MapState = { text: "", curId: "", curStreamed: 0 };
    const res = await streamJsonl({
      bin,
      args,
      stdin,
      abort: opts.abort,
      onObject: (o) => mapCodex(o, state, opts.onDelta),
    });

    if (opts.abort?.signal.aborted) return { text: state.text, sessionId: state.sessionId, ok: false };
    if (state.text.trim()) {
      return { text: state.text, sessionId: state.sessionId, ok: true, usage: state.usage };
    }
    const error = state.error ?? res.stderr ?? `codex exited ${res.code}`;
    log.error(`run failed: ${error}`);
    return { text: "", sessionId: state.sessionId, ok: false, error, usage: state.usage };
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    return discoverViaCli();
  }
}

function mapCodex(
  o: Record<string, unknown>,
  state: MapState,
  onDelta?: (t: string) => void,
): void {
  const type = o.type;
  if (type === "thread.started" && typeof o.thread_id === "string") {
    state.sessionId = o.thread_id;
  } else if (type === "item.completed" || type === "item.updated") {
    const item = o.item as Record<string, unknown> | undefined;
    if (item?.type !== "agent_message" || typeof item.text !== "string") return;
    const text = item.text;
    const id = item.id as string;
    if (type === "item.completed") {
      // item.completed carries the full message; stream any tail not yet sent.
      const already = id === state.curId ? state.curStreamed : 0;
      const tail = text.slice(already);
      if (tail) onDelta?.(tail);
      state.text += (state.text ? "\n" : "") + text;
      state.curId = "";
      state.curStreamed = 0;
    } else {
      if (id !== state.curId) {
        state.curId = id;
        state.curStreamed = 0;
      }
      const d = text.slice(state.curStreamed);
      if (d) {
        state.curStreamed = text.length;
        onDelta?.(d);
      }
    }
  } else if (type === "turn.completed") {
    const u = o.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (u) state.usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
  } else if (type === "turn.failed") {
    const err = o.error as Record<string, unknown> | undefined;
    state.error = (err?.message as string) ?? "codex turn failed";
  } else if (type === "error") {
    state.error = (o.message as string) ?? "codex error";
  }
}

function mapEffort(effort?: Effort): string | undefined {
  // VibeOS Effort ⊂ Codex model_reasoning_effort (minimal|low|medium|high|xhigh).
  return effort;
}

/**
 * Discover Codex models via `codex debug models` (JSON, no API key needed — uses
 * the CLI's own login). Best-effort: [] on any failure. Mirrors Omakase's daemon.
 */
async function discoverViaCli(): Promise<DiscoveredModel[]> {
  const bin = whichBinary("codex");
  if (!bin) return [];
  const proc = Bun.spawn([bin, "debug", "models"], {
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env } as Record<string, string>,
  });
  const kill = setTimeout(() => proc.kill(), 10_000);
  try {
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const start = text.indexOf("{");
    if (start === -1) return [];
    const json = JSON.parse(text.slice(start)) as { models?: CodexDebugModel[] };
    const models = Array.isArray(json.models) ? json.models : [];
    return models
      .filter((m) => m.slug && m.visibility !== "hide" && m.visibility !== "hidden")
      .map((m) => ({ modelId: m.slug!, name: m.display_name ?? m.slug!, description: m.description }));
  } catch (e) {
    log.warn(`model discovery failed: ${e instanceof Error ? e.message : e}`);
    return [];
  } finally {
    clearTimeout(kill);
  }
}

export const codexProvider = new CodexProvider();
