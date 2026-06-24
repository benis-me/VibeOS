import type { ProviderId } from "@vibeos/shared/domain";
import type {
  AiProvider,
  DiscoveredModel,
  ProviderRunOptions,
  RunResult,
  TokenUsage,
} from "../types.ts";
import { whichBinary } from "../detect.ts";
import { streamJsonl } from "./exec.ts";
import { cliEnv } from "./env.ts";
import { scrapeModelList } from "./scrapeModelList.ts";
import { logger } from "../../../util/log.ts";

export interface AnthropicCliConfig {
  id: ProviderId;
  label: string;
  /** Binary name on PATH (`claude`, `codebuddy`). */
  bin: string;
  /** Models to offer when live discovery yields nothing. */
  fallbackModels?: DiscoveredModel[];
  /**
   * Discover models by parsing `<bin> --help` (older CodeBuddy listed its
   * supported models there as `Currently supported: (id, id, …)`). Claude has no
   * such list, so it relies on {@link fallbackModels} aliases instead.
   */
  discoverViaHelp?: boolean;
  /**
   * Provider lists its models only in the interactive `/model list` TUI (current
   * CodeBuddy). Enables {@link AnthropicCliProvider.discoverModelsLive}, a slow
   * PTY scrape run ONLY on the user's explicit "Fetch models" click.
   */
  liveModelList?: boolean;
}

interface MapState {
  text: string;
  streamed: boolean;
  sessionId?: string;
  error?: string;
  usage?: TokenUsage;
}

/**
 * Drives a Claude-Code-style CLI directly (`<bin> -p --output-format stream-json`),
 * replacing the vendor SDK. Both `claude` and `codebuddy` (a Claude-Code fork)
 * speak the same Anthropic stream-json protocol, so they share this class.
 * `--setting-sources ""` matches the SDK's `settingSources: []` — no user
 * settings/hooks fire during generation.
 */
export class AnthropicCliProvider implements AiProvider {
  readonly id: ProviderId;
  readonly label: string;
  private readonly bin: string;
  private readonly fallbackModels: DiscoveredModel[];
  private readonly discoverViaHelp: boolean;
  private readonly liveModelList: boolean;
  private readonly log: ReturnType<typeof logger>;

  constructor(cfg: AnthropicCliConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
    this.bin = cfg.bin;
    this.fallbackModels = cfg.fallbackModels ?? [];
    this.discoverViaHelp = cfg.discoverViaHelp ?? false;
    this.liveModelList = cfg.liveModelList ?? false;
    this.log = logger(`provider:${cfg.id}`);
  }

  async run(opts: ProviderRunOptions): Promise<RunResult> {
    const bin = whichBinary(this.bin);
    if (!bin) return { text: "", ok: false, error: `${this.bin} CLI not found on PATH` };

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--setting-sources",
      "",
      "--permission-mode",
      "bypassPermissions",
      "--max-turns",
      "6",
      "--disallowedTools",
      "*",
      "--append-system-prompt",
      opts.systemPrompt,
    ];
    if (opts.onDelta) args.push("--include-partial-messages");
    if (opts.model) args.push("--model", opts.model);
    if (opts.fallbackModel) args.push("--fallback-model", opts.fallbackModel);
    if (opts.effort) args.push("--effort", opts.effort);
    if (opts.sessionId) args.push("--resume", opts.sessionId);

    const state: MapState = { text: "", streamed: false };
    const res = await streamJsonl({
      bin,
      args,
      stdin: opts.prompt,
      abort: opts.abort,
      onObject: (o) => mapAnthropic(o, state, opts.onDelta),
    });

    if (opts.abort?.signal.aborted)
      return { text: state.text, sessionId: state.sessionId, ok: false };
    // Salvage: any usable text → ok, even if the run also reported an error
    // (e.g. max-turns) or a non-zero exit.
    if (state.text.trim()) {
      return { text: state.text, sessionId: state.sessionId, ok: true, usage: state.usage };
    }

    const error = state.error ?? res.stderr ?? `${this.bin} exited ${res.code}`;
    this.log.error(`run failed: ${error}`);
    return { text: "", sessionId: state.sessionId, ok: false, error, usage: state.usage };
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    if (this.discoverViaHelp) {
      const fromHelp = await discoverFromHelp(this.bin);
      if (fromHelp.length) return fromHelp;
    }
    return this.fallbackModels;
  }

  /**
   * User-triggered live discovery: scrape the interactive `/model list` TUI via a
   * PTY (CodeBuddy's only programmatic source). Slow — never call on boot/scan.
   * Falls back to the cheap path if the provider doesn't advertise a TUI list.
   */
  async discoverModelsLive(): Promise<DiscoveredModel[]> {
    if (!this.liveModelList) return this.discoverModels();
    const live = await scrapeModelList(this.bin);
    return live.length ? live : this.discoverModels();
  }
}

/**
 * Parse `<bin> --help` for a `Currently supported: (id, id, …)` model list.
 * CodeBuddy advertises its models this way; best-effort, [] on any failure.
 */
async function discoverFromHelp(bin: string): Promise<DiscoveredModel[]> {
  const path = whichBinary(bin);
  if (!path) return [];
  const proc = Bun.spawn([path, "--help"], {
    stdout: "pipe",
    stderr: "ignore",
    env: cliEnv() as Record<string, string>,
  });
  const kill = setTimeout(() => proc.kill(), 10_000);
  try {
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const m = /Currently supported:\s*\(([^)]+)\)/.exec(text);
    if (!m) return [];
    return m[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => ({ modelId: id, name: id }));
  } catch {
    return [];
  } finally {
    clearTimeout(kill);
  }
}

function mapAnthropic(
  m: Record<string, unknown>,
  state: MapState,
  onDelta?: (t: string) => void,
): void {
  if (typeof m.session_id === "string") state.sessionId = m.session_id;

  if (m.type === "stream_event") {
    const delta = extractStreamTextDelta(m);
    if (delta) {
      state.text += delta;
      state.streamed = true;
      onDelta?.(delta);
    }
  } else if (m.type === "assistant") {
    if (!state.streamed) {
      const text = extractAssistantText(m);
      if (text) {
        state.text += text;
        onDelta?.(text);
      }
    }
  } else if (m.type === "result") {
    if (m.subtype === "success" && typeof m.result === "string" && !state.text) {
      state.text = m.result;
      onDelta?.(m.result);
    }
    if (m.is_error === true || m.subtype === "error") {
      state.error = typeof m.result === "string" ? m.result : "generation error";
    }
    const u = m.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    state.usage = {
      inputTokens: u?.input_tokens,
      outputTokens: u?.output_tokens,
      costUsd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : undefined,
    };
  }
}

function extractAssistantText(m: Record<string, unknown>): string {
  const message = m.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") out += b.text;
  }
  return out;
}

/** Pull a visible text delta out of an Anthropic-style stream_event. */
function extractStreamTextDelta(m: Record<string, unknown>): string {
  const event = m.event as Record<string, unknown> | undefined;
  if (!event) return "";
  if (event.type === "content_block_delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") return delta.text;
  }
  return "";
}
