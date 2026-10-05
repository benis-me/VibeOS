import type { ProviderId } from "@vibeos/shared/domain";
import type {
  AiProvider,
  DiscoveredModel,
  ProviderRunOptions,
  RunResult,
  TokenUsage,
} from "../types.ts";
import { newestBinary } from "../detect.ts";
import { streamJsonl } from "./exec.ts";
import { logger } from "../../../util/log.ts";

export interface AnthropicCliConfig {
  id: ProviderId;
  label: string;
  /** Binary name on PATH (`claude`, `codebuddy`). */
  bin: string;
  /** Models to offer when live discovery yields nothing. */
  fallbackModels?: DiscoveredModel[];
}

/** An SDK `initialize` request; the reply carries the CLI's `/model` menu. */
const INITIALIZE = `${JSON.stringify({
  type: "control_request",
  request_id: "models",
  request: { subtype: "initialize" },
})}\n`;

interface MapState {
  text: string;
  succeeded?: boolean;
  streamed: boolean;
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
  private readonly log: ReturnType<typeof logger>;

  constructor(cfg: AnthropicCliConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
    this.bin = cfg.bin;
    this.fallbackModels = cfg.fallbackModels ?? [];
    this.log = logger(`provider:${cfg.id}`);
  }

  async run(opts: ProviderRunOptions): Promise<RunResult> {
    const bin = await newestBinary(this.bin);
    if (!bin) return { text: "", ok: false, error: `${this.bin} CLI not found on PATH` };

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--setting-sources",
      "",
      // No tools and our prompt instead of the CLI's coding-agent prompt: tool
      // definitions alone were ~40k input tokens per call, and that agent prompt
      // nudged the model toward tool calls. Permissions stay unbypassed.
      "--max-turns",
      "6",
      "--tools",
      "",
      "--disallowedTools",
      "*",
      "--system-prompt",
      opts.systemPrompt,
    ];
    if (opts.onDelta) args.push("--include-partial-messages");
    if (opts.model) args.push("--model", opts.model);
    if (opts.fallbackModel) args.push("--fallback-model", opts.fallbackModel);
    if (opts.effort) args.push("--effort", opts.effort);

    const state: MapState = { text: "", streamed: false };
    const res = await streamJsonl({
      bin,
      args,
      stdin: opts.prompt,
      abort: opts.abort,
      onObject: (o) => mapAnthropic(o, state, opts.onDelta),
    });

    if (opts.abort?.signal.aborted) return { text: state.text, ok: false };
    if (state.text.trim() && state.succeeded && !state.error && res.code === 0) {
      return { text: state.text, ok: true, usage: state.usage };
    }

    const error =
      state.error || res.stderr || `${this.bin} did not complete successfully (exit ${res.code})`;
    this.log.error(`run failed: ${error}`);
    return { text: "", ok: false, error, usage: state.usage };
  }

  /**
   * The account's `/model` menu, answered to an `initialize` request with no
   * prompt sent (nothing is generated). Claude replies with aliases plus a
   * description naming the version; CodeBuddy with plain ids and names.
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    const bin = await newestBinary(this.bin);
    if (!bin) return this.fallbackModels;
    const models: DiscoveredModel[] = [];
    const abort = new AbortController();
    const kill = setTimeout(() => abort.abort(), 15_000);
    try {
      await streamJsonl({
        bin,
        args: [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--setting-sources",
          "",
        ],
        stdin: INITIALIZE,
        abort,
        onObject: (o) => {
          if (o.type !== "control_response") return;
          const reply = (o.response as { response?: { models?: InitModel[] } } | undefined)
            ?.response;
          for (const m of reply?.models ?? []) {
            const modelId = m.value ?? m.id;
            const label = m.displayName ?? m.name ?? modelId;
            const head = m.description?.split(" · ")[0];
            if (modelId && label) {
              models.push({ modelId, name: head?.startsWith(label) ? head : label });
            }
          }
        },
      });
    } catch (e) {
      this.log.warn(`model discovery failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      clearTimeout(kill);
    }
    return models.length ? models : this.fallbackModels;
  }
}

interface InitModel {
  value?: string;
  id?: string;
  displayName?: string;
  name?: string;
  description?: string;
}

function mapAnthropic(
  m: Record<string, unknown>,
  state: MapState,
  onDelta?: (t: string) => void,
): void {
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
    state.succeeded = m.subtype === "success" && m.is_error !== true;
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
