import type { AiOp, DragPayload } from "@vibeos/shared/protocol";
import { NATIVE_PRESET_APPS } from "@vibeos/shared/domain";
import { bus } from "../events/bus.ts";
import { broadcast } from "../server/wsGateway.ts";
import { getApp } from "../db/repositories/AppRepo.ts";
import { getWindow } from "../db/repositories/WindowRepo.ts";
import {
  getMemory,
  ensureMemory,
  recentInteractions,
  saveSnapshot,
  saveSummary,
  addInteraction,
} from "../db/repositories/AppMemoryRepo.ts";
import { kernelState } from "../kernel/kernelState.ts";
import { loadSettings } from "../db/repositories/SettingsRepo.ts";
import { assemblePrompt, decideRenderMode } from "../prompt/PromptAssembler.ts";
import { run, recordSummary } from "../ai/SdkManager.ts";
import { parseAiOutput, extractStreamingHtml } from "../ai/streamParser.ts";
import * as Syscalls from "../syscall/SyscallInterpreter.ts";
import { applyRegionsServer, extractRegionIds } from "./regionMerge.ts";
import { rewriteImages } from "../ai/imageCache.ts";
import { logger } from "../util/log.ts";

const log = logger("ui-gen");

interface Trigger {
  firstRender?: boolean;
  op?: AiOp;
  drag?: DragPayload;
  /** Seed prompt for an AI-spawned popup window. */
  seedPrompt?: string;
}

/**
 * Preemptive, per-window concurrency.
 *
 * - Different windows run fully in PARALLEL (each tracked independently).
 * - Within ONE window, a new trigger PREEMPTS the in-flight one: we abort the
 *   old SDK call and start the new one immediately ("latest wins"). The aborted
 *   run writes nothing.
 *
 * UI generation runs STATELESS — each op is a fresh conversation (no session
 * resume). The full current UI is sent every time via [CURRENT UI], so the
 * model has the complete structure without relying on accumulated session
 * history (which would grow unbounded and could drift from the merged DOM).
 */
interface InFlight {
  abort: AbortController;
  /** generation counter — only the newest run for a window may commit. */
  gen: number;
}
const inflight = new Map<string, InFlight>();
const genCounter = new Map<string, number>();

function dispatch(windowId: string, trigger: Trigger): void {
  // Preempt any in-flight run for this same window.
  const prev = inflight.get(windowId);
  if (prev) {
    prev.abort.abort();
    log.debug(`preempt [${windowId.slice(-6)}] — newer action superseded older`);
  }

  const gen = (genCounter.get(windowId) ?? 0) + 1;
  genCounter.set(windowId, gen);
  const abort = new AbortController();
  inflight.set(windowId, { abort, gen });

  void generate(windowId, trigger, gen, abort)
    .catch((e) => {
      if (genCounter.get(windowId) !== gen) return;
      log.error(`generate threw [${windowId.slice(-6)}]`, e instanceof Error ? e.message : e);
      if (!getMemory(windowId)?.htmlSnapshot) {
        broadcast("s2c.ui.patch", { windowId, mode: "full", html: "", done: true });
      }
      broadcast("s2c.ui.busy", { windowId, busy: false });
      broadcast("s2c.error", {
        code: "ai_failed",
        detail: e instanceof Error ? e.message : String(e),
        windowId,
      });
    })
    .finally(() => {
      // Only clear if we're still the current run (a newer one may have replaced us).
      if (inflight.get(windowId)?.gen === gen) inflight.delete(windowId);
    });
}

/**
 * Stop the in-flight generation for a window (e.g. when it's closed). Aborting
 * the SDK call kills the CLI subprocess, so we don't keep paying for output the
 * user can no longer see. Bumping the generation counter makes any straggler
 * result count as stale and commit nothing.
 */
function abortWindow(windowId: string): void {
  const cur = inflight.get(windowId);
  if (cur) {
    cur.abort.abort();
    inflight.delete(windowId);
    genCounter.set(windowId, (genCounter.get(windowId) ?? 0) + 1);
    log.debug(`✕ [${windowId.slice(-6)}] window closed — generation aborted`);
  }
}

export function registerUiGenerationAgent(): void {
  bus.on("window.firstRender", ({ windowId }) => dispatch(windowId, { firstRender: true }));
  bus.on("window.spawnRender", ({ windowId, seedPrompt }) =>
    dispatch(windowId, { firstRender: true, seedPrompt }),
  );
  bus.on("op.received", ({ windowId, op }) => dispatch(windowId, { op }));
  bus.on("op.dragdrop", ({ windowId, source }) => {
    if (windowId) dispatch(windowId, { drag: source });
  });
  bus.on("window.closed", ({ windowId }) => abortWindow(windowId));
}

/** True if this run has been superseded by a newer one for the same window. */
function isStale(windowId: string, gen: number, abort: AbortController): boolean {
  return abort.signal.aborted || genCounter.get(windowId) !== gen;
}

async function generate(
  windowId: string,
  trigger: Trigger,
  gen: number,
  abort: AbortController,
): Promise<void> {
  const win = getWindow(windowId);
  const app = win ? getApp(win.appId) : null;
  if (!win?.isOpen || !app) {
    return;
  }
  if (app.presetId && NATIVE_PRESET_APPS.includes(app.presetId)) return;

  await ensureMemory(windowId, app.id);
  if (isStale(windowId, gen, abort)) return;
  const memory = getMemory(windowId);
  const firstRender = trigger.firstRender ?? false;

  broadcast("s2c.ui.busy", { windowId, busy: true });

  if (trigger.op || trigger.drag) {
    await addInteraction({
      windowId,
      opKind: trigger.op?.kind ?? "dragdrop",
      opPayload: trigger.op ?? trigger.drag,
    });
  }

  const snapshot = memory?.htmlSnapshot ?? "";
  const regionIds = extractRegionIds(snapshot);
  // Decide render mode BEFORE calling the AI — the model is then told exactly
  // which mode to use, rather than guessing.
  const renderMode = decideRenderMode({
    firstRender,
    hasSnapshot: snapshot.trim().length > 0,
    hasRegions: regionIds.length > 0 && new Set(regionIds).size === regionIds.length,
    isSpawn: !!trigger.seedPrompt,
  });

  const prompt = assemblePrompt({
    app,
    memory,
    recent: recentInteractions(windowId),
    globalState: kernelState.snapshotForPrompt(),
    windowSize: { w: win.rect.w, h: win.rect.h - (win.kind === "widget" ? 0 : 36) },
    op: trigger.op,
    drag: trigger.drag,
    seedPrompt: trigger.seedPrompt,
    firstRender,
    renderMode,
    regionIds,
    profileEntries: loadSettings().profileEntries,
  });

  const reason = firstRender
    ? "first-render"
    : trigger.op
      ? `op:${trigger.op.kind}/${trigger.op.action ?? "?"}`
      : trigger.drag
        ? `drop:${trigger.drag.kind}`
        : "?";
  log.info(
    `▶ ${app.name} [${windowId.slice(-6)}] ${reason} mode=${renderMode} (prompt ${prompt.length} chars)`,
  );
  const t0 = performance.now();

  const canCommit = () => !isStale(windowId, gen, abort);
  let repairReason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!canCommit()) return;
    let buffer = "";
    let lastStreamed = "";
    const fullRequired = renderMode === "force-full" || attempt > 0;
    const result = await run({
      role: "ui-generation",
      trigger: firstRender ? "user" : "event",
      prompt:
        attempt === 0
          ? prompt
          : `${prompt}\n\n[RENDER REPAIR: FULL REQUIRED]\nThe previous output was rejected: ${repairReason}. It was NOT applied and none of its syscalls ran. Respond to the original operation using CURRENT UI. Return the COMPLETE window body in <vibeos-html mode="full">; no region patch this time.`,
      // Every attempt is stateless, including a repair of invalid output.
      abort,
      appName: app.name,
      onDelta: (text) => {
        // ponytail: stream only first paint; existing windows commit one validated
        // batch. Streaming edits would need transactional preview + rollback.
        if (!canCommit() || snapshot.trim() || attempt > 0) return;
        buffer += text;
        const body = extractStreamingHtml(buffer);
        if (body !== null && body.length > lastStreamed.length) {
          lastStreamed = body;
          broadcast("s2c.ui.patch", { windowId, mode: "full", html: body, streaming: true });
        }
      },
    });

    if (!canCommit()) {
      if (genCounter.get(windowId) === gen) throw new Error(result.error ?? "Generation aborted");
      return;
    }
    if (!result.ok) throw new Error(result.error ?? "Generation failed");

    const parsed = parseAiOutput(result.text, fullRequired ? "full" : undefined);
    let html: string | undefined;
    let regions = parsed.regions;
    try {
      if (parsed.renderError) throw new Error(parsed.renderError);
      if (regions?.length) {
        if (fullRequired) throw new Error("A complete window body is required");
        html = applyRegionsServer(snapshot, regions);
      } else if (parsed.html !== undefined) {
        html = parsed.html;
      } else if (!parsed.syscalls.length) {
        throw new Error("The model returned no UI or system action");
      }
    } catch (error) {
      repairReason = error instanceof Error ? error.message : String(error);
      await recordSummary(result.runId, `Rejected UI: ${repairReason}`);
      if (!canCommit()) return;
      if (attempt === 1) throw error;
      log.warn(`Invalid UI [${windowId.slice(-6)}]: ${repairReason}; retrying full render`);
      continue;
    }

    if (html !== undefined) {
      // Image generation starts only after the output has passed validation.
      html = rewriteImages(html);
      regions = regions?.map((r) => ({ ...r, html: rewriteImages(r.html) }));
      // Evaluate the guard INSIDE the single-writer queue, not just before awaiting it.
      if (!(await saveSnapshot(windowId, html, canCommit)) || !canCommit()) return;
      broadcast(
        "s2c.ui.patch",
        regions?.length
          ? { windowId, mode: "regions", regions, done: true }
          : { windowId, mode: "full", html, done: true },
      );
    } else {
      // Clear any first-paint preview when a successful response has only syscalls.
      if (!snapshot.trim() && lastStreamed) {
        broadcast("s2c.ui.patch", { windowId, mode: "full", html: snapshot, done: true });
      }
      broadcast("s2c.ui.busy", { windowId, busy: false });
    }

    const what =
      parsed.summary ||
      (regions?.length
        ? `Patched ${regions.length} region(s)`
        : html !== undefined
          ? "Rendered full window"
          : "No output");
    log.info(
      `✓ ${app.name} [${windowId.slice(-6)}] ${regions?.length ? `${regions.length} region(s)` : "full"}, ${(performance.now() - t0).toFixed(0)}ms`,
    );
    if (parsed.summary) await saveSummary(windowId, parsed.summary, canCommit);
    await recordSummary(result.runId, what);
    if (!canCommit()) return;
    if (parsed.syscalls.length > 0) {
      await Syscalls.execute(parsed.syscalls, {
        windowId,
        appId: app.id,
        source: "syscall",
        resizeFrom: firstRender ? win.rect : undefined,
      });
    }
    return;
  }
}
