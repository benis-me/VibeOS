import type { AgentRole, AgentTrigger } from "@vibeos/shared/domain";
import { DEFAULT_LOCALE } from "@vibeos/shared/domain";
import { ModelPolicy } from "./ModelPolicy.ts";
import { estimateCostUsd } from "./pricing.ts";
import { systemPromptFor, localeDirective } from "../prompt/systemPrompts.ts";
import { env } from "../config/env.ts";
import { activeProviderId, availableProviderIds, getProvider } from "./providers/index.ts";
import type { AiProvider, RunResult } from "./providers/types.ts";
import { loadSettings } from "../db/repositories/SettingsRepo.ts";
import * as AgentRepo from "../db/repositories/AgentRepo.ts";
import { broadcast } from "../server/wsGateway.ts";
import { logger } from "../util/log.ts";

const log = logger("sdk");

export type { RunResult };

/** Live runs by id → their abort controller, so the UI can stop one. */
const runRegistry = new Map<string, AbortController>();
/** Runs the user explicitly stopped (recorded as "aborted", not "error"). */
const stoppedRuns = new Set<string>();

/** Abort an in-flight run by id (Activity Monitor "Stop"). */
export function stopRun(runId: string): boolean {
  const c = runRegistry.get(runId);
  if (!c) return false;
  stoppedRuns.add(runId);
  c.abort();
  return true;
}

export interface RunOptions {
  role: AgentRole;
  trigger: AgentTrigger;
  prompt: string;
  /** Resume a prior session (per-window continuity). Provider-native id. */
  sessionId?: string;
  /** Called with incremental assistant text. */
  onDelta?: (text: string) => void;
  abort?: AbortController;
  /** Override the role's default system prompt (e.g. for one-off tasks). */
  systemPromptOverride?: string;
  /** App/window this run is for, recorded for the Activity Monitor. */
  appName?: string;
}

/** Attach a one-line summary of what a run produced, and re-broadcast it. */
export async function recordSummary(runId: string | undefined, summary: string): Promise<void> {
  if (!runId || !summary.trim()) return;
  const run = await AgentRepo.setSummary(runId, summary.trim().slice(0, 200));
  if (run) broadcast("s2c.agent.run", { run });
}

/**
 * The single seam between the OS and whatever AI backend is active. Resolves
 * the role's model policy + localized system prompt, tracks the run, handles
 * stub mode, then delegates to the active {@link AiProvider}. Callers never see
 * which provider (CodeBuddy / Claude / Codex / OpenRouter) actually ran.
 */
export async function run(opts: RunOptions): Promise<RunResult> {
  const cfg = ModelPolicy.for(opts.role);
  const run = await AgentRepo.startRun({
    role: opts.role,
    trigger: opts.trigger,
    model: cfg.model,
    appName: opts.appName,
  });
  broadcast("s2c.agent.run", { run });

  const finish = async (result: RunResult): Promise<RunResult> => {
    // Fill in cost when the provider reported tokens but no dollar figure
    // (codebuddy / codex / openrouter) using an estimate from the model price.
    const usage = result.usage
      ? {
          ...result.usage,
          costUsd:
            result.usage.costUsd ??
            estimateCostUsd(cfg.model, result.usage.inputTokens, result.usage.outputTokens),
        }
      : undefined;
    runRegistry.delete(run.id);
    const status = stoppedRuns.has(run.id) ? "aborted" : result.ok ? "ok" : "error";
    stoppedRuns.delete(run.id);
    const finished = await AgentRepo.endRun(run.id, status, result.error, usage);
    if (finished) broadcast("s2c.agent.run", { run: finished });
    return { ...result, runId: run.id };
  };

  if (env.aiStub) {
    const text = stubResponse(opts.role, opts.prompt);
    opts.onDelta?.(text);
    return finish({ text, ok: true });
  }

  // Skin is applied purely via CSS (design tokens + .ai-surface control styles),
  // so generated HTML stays skin-neutral and every app — old and new — re-skins
  // live when the skin changes. We deliberately do NOT tell the agent the skin.
  const locale = loadSettings().locale ?? DEFAULT_LOCALE;
  const systemPrompt =
    (opts.systemPromptOverride ?? systemPromptFor(opts.role)) + localeDirective(locale);
  // Track the run so the Activity Monitor can stop it. Reuse the caller's abort
  // controller when given (window close already aborts via it), else make one.
  const controller = opts.abort ?? new AbortController();
  const preempt = controller.signal;
  runRegistry.set(run.id, controller);

  // One provider attempt with its own hang-guard timeout, linked to the caller's
  // preemption signal. The timer re-arms on each streamed delta, so it fires only
  // on a true stall, not on a slow-but-progressing generation.
  const attempt = async (
    provider: AiProvider,
    model: string | undefined,
    stream: boolean,
  ): Promise<{ result: RunResult; timedOut: boolean }> => {
    const abort = new AbortController();
    const onPreempt = () => abort.abort();
    if (preempt?.aborted) abort.abort();
    else preempt?.addEventListener("abort", onPreempt, { once: true });

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, env.genTimeoutMs);
    };
    arm();
    try {
      const r = await provider.run({
        prompt: opts.prompt,
        systemPrompt,
        model,
        fallbackModel: cfg.fallbackModel,
        effort: cfg.effort,
        thinking: cfg.thinking,
        sessionId: stream ? opts.sessionId : undefined,
        abort,
        onDelta: stream && opts.onDelta ? (t) => { arm(); opts.onDelta!(t); } : undefined,
      });
      return {
        result: timedOut ? { ...r, ok: false, error: `timed out after ${env.genTimeoutMs}ms` } : r,
        timedOut,
      };
    } finally {
      clearTimeout(timer);
      preempt?.removeEventListener("abort", onPreempt);
    }
  };

  const provider = await getProvider(cfg.providerId ?? activeProviderId());
  log.debug(
    `query ${opts.role} via ${provider.id} model=${cfg.model ?? "(default)"} effort=${cfg.effort} thinking=${cfg.thinking?.type} locale=${locale}${opts.sessionId ? " resume" : ""}`,
  );

  let { result, timedOut } = await attempt(provider, cfg.model, true);

  // Recover from a genuine provider failure (not preemption, not a hang/timeout):
  // retry once on the same provider, then fall back to another available backend.
  // Recovery attempts don't stream — they yield a final result patched in one go.
  const recoverable = () => !result.ok && !timedOut && !preempt?.aborted;
  if (recoverable()) {
    log.warn(`${provider.id} failed (${result.error}); retrying once`);
    ({ result, timedOut } = await attempt(provider, cfg.model, false));
  }
  if (recoverable()) {
    const fallbackId = availableProviderIds().find((id) => id !== provider.id);
    if (fallbackId) {
      log.warn(`${provider.id} still failing; falling back to ${fallbackId}`);
      ({ result, timedOut } = await attempt(await getProvider(fallbackId), undefined, false));
    }
  }

  if (!result.ok) log.error(`run failed (${opts.role}): ${result.error ?? "unknown"}`);
  return finish(result);
}

/** Deterministic offline stub so the OS is usable without any provider. */
function stubResponse(role: AgentRole, prompt: string): string {
  if (role === "ui-generation") {
    const isFirst = prompt.includes("just launched");
    if (isFirst) {
      return `<vibeos-html>
<div data-vibeos-region="root" style="display:flex;flex-direction:column;gap:12px;padding:8px">
  <h2 style="margin:0;font-size:18px">Hello from VibeOS (stub)</h2>
  <p style="color:#888;margin:0">The text model is in stub mode. Pick a provider and unset VIBEOS_AI_STUB.</p>
  <button data-vibeos-action="ping" style="align-self:flex-start;padding:6px 12px;border:1px solid #555;border-radius:8px;background:transparent;color:inherit">Ping</button>
</div>
</vibeos-html>
<vibeos-summary>The app launched in stub mode.</vibeos-summary>`;
    }
    return `<vibeos-html>
<div data-vibeos-region="root" style="padding:8px">
  <p style="margin:0">You interacted (stub). Time: ${new Date().toLocaleTimeString()}</p>
  <button data-vibeos-action="ping" style="margin-top:8px;padding:6px 12px;border:1px solid #555;border-radius:8px;background:transparent;color:inherit">Ping again</button>
</div>
</vibeos-html>
<vibeos-summary>The user pinged the stub app.</vibeos-summary>`;
  }
  if (role === "system-event") {
    return `\`\`\`vibeos-syscall
{ "calls": [ { "type": "notify", "title": "System (stub)", "body": "A quiet moment passes in VibeOS.", "kind": "info" } ] }
\`\`\`
<vibeos-summary>An ambient stub event fired.</vibeos-summary>`;
  }
  return `<vibeos-summary>Memory consolidated (stub).</vibeos-summary>`;
}
