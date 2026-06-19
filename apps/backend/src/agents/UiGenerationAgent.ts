import type { AiOp, DragPayload } from "@vibeos/shared/protocol";
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
import { parseAiOutput, extractStreamingHtml, extractRegions } from "../ai/streamParser.ts";
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
      if (abort.signal.aborted) return; // expected on preemption
      log.error(`generate threw [${windowId.slice(-6)}]`, e instanceof Error ? e.message : e);
      broadcast("s2c.ui.busy", { windowId, busy: false });
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
  if (!win || !win.isOpen || !app) {
    return;
  }

  await ensureMemory(windowId, app.id);
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
  // Decide render mode BEFORE calling the AI — the model is then told exactly
  // which mode to use, rather than guessing.
  const renderMode = decideRenderMode({
    firstRender,
    hasSnapshot: snapshot.trim().length > 0,
    isDrag: !!trigger.drag,
    isSpawn: !!trigger.seedPrompt,
  });
  const regionIds =
    renderMode === "prefer-incremental" ? extractRegionIds(snapshot) : undefined;

  const prompt = assemblePrompt({
    app,
    memory,
    recent: recentInteractions(windowId),
    globalState: kernelState.snapshotForPrompt(),
    windowSize: { w: win.rect.w, h: win.rect.h - 36 /* titlebar */ },
    op: trigger.op,
    drag: trigger.drag,
    seedPrompt: trigger.seedPrompt,
    firstRender,
    renderMode,
    regionIds,
    userProfile: loadSettings().userProfile,
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

  // Stream the HTML body to the client as it arrives (full-replace frames).
  let buffer = "";
  let lastStreamed = "";
  // Per-region content already streamed this run (id → html), so a region that
  // closed on an earlier delta isn't re-broadcast on every subsequent one.
  const streamedRegions = new Map<string, string>();
  const result = await run({
    role: "ui-generation",
    trigger: firstRender ? "user" : "event",
    prompt,
    // No sessionId → every op is a fresh, self-contained conversation.
    abort,
    appName: app.name,
    onDelta: (text) => {
      if (isStale(windowId, gen, abort)) return; // superseded — stop streaming
      buffer += text;
      const body = extractStreamingHtml(buffer);
      if (body === null) return;

      if (renderMode === "force-full") {
        // Full render: the streamed body IS the whole window, so push it as a
        // growing full-replace frame.
        if (body !== lastStreamed && body.length > lastStreamed.length) {
          lastStreamed = body;
          broadcast("s2c.ui.patch", { windowId, mode: "full", html: body, streaming: true });
        }
        return;
      }

      // Incremental render: stream each data-vibeos-region as soon as it closes.
      // extractRegions is depth-aware and silently skips a region whose end tag
      // hasn't arrived yet, so we never push an unbalanced fragment into the DOM,
      // and the client merges each patch into its intact snapshot (no clobber).
      const regions = extractRegions(body);
      if (regions.length === 0) return;
      // If the AI actually upgraded to a full structural replace it writes a
      // whole new body, so complete NON-region elements show up next to the
      // regions. Don't stream region-by-region then — that would stack half a
      // new layout over the old one; let the final full patch swap it in one go.
      let rest = body;
      for (const r of regions) rest = rest.replace(r.html, "");
      if (/<\/[a-zA-Z][\w-]*\s*>/.test(rest)) return;
      // Crucial: if a data-vibeos-region attribute STILL remains in `rest`, an
      // outer region container is mid-stream and the regions we just closed are
      // its CHILDREN. The final parse keys off that outer region (extractRegions
      // is depth-aware and skips nested ones), so streaming the inner children
      // now patches at the wrong granularity: the client can't find those ids in
      // its snapshot, appends them OUTSIDE the container, and the closing outer
      // patch then reshuffles the DOM — making parts of the app vanish. Wait for
      // the outer region to close; we'll stream it as one unit, matching `done`.
      if (/data-vibeos-region/.test(rest)) return;

      const fresh = regions.filter((r) => streamedRegions.get(r.region) !== r.html);
      if (fresh.length === 0) return;
      for (const r of fresh) streamedRegions.set(r.region, r.html);
      broadcast("s2c.ui.patch", { windowId, mode: "regions", regions: fresh, streaming: true });
    },
  });

  if (isStale(windowId, gen, abort)) {
    // Superseded by a newer action → that run owns the UI; just drop this one.
    // Aborted while still current → the hang guard fired; the window would be
    // stuck on a spinner, so clear it and surface the failure.
    if (genCounter.get(windowId) !== gen) {
      log.debug(`⏭ ${app.name} [${windowId.slice(-6)}] result discarded (superseded)`);
    } else {
      log.warn(`⏱ ${app.name} [${windowId.slice(-6)}] aborted (${result.error ?? "timeout"})`);
      broadcast("s2c.ui.busy", { windowId, busy: false });
      broadcast("s2c.error", { code: "ai_failed", detail: result.error, windowId });
    }
    return;
  }

  const dt = (performance.now() - t0).toFixed(0);

  const parsed = parseAiOutput(result.text);

  const current = memory?.htmlSnapshot ?? "";
  if (parsed.html !== undefined) {
    // Resolve <img data-vibe-img> placeholders → /api/img/:id (generates + caches).
    const html = rewriteImages(parsed.html);
    await saveSnapshot(windowId, html);
    broadcast("s2c.ui.patch", { windowId, mode: "full", html, done: true });
    log.info(
      `✓ ${app.name} [${windowId.slice(-6)}] full render ${html.length} chars, ${parsed.syscalls.length} syscall(s) in ${dt}ms`,
    );
  } else if (parsed.regions && parsed.regions.length > 0) {
    const regions = parsed.regions.map((r) => ({ ...r, html: rewriteImages(r.html) }));
    const merged = applyRegionsServer(current, regions);
    await saveSnapshot(windowId, merged);
    broadcast("s2c.ui.patch", { windowId, mode: "regions", regions, done: true });
    log.info(
      `✓ ${app.name} [${windowId.slice(-6)}] patched ${regions.length} region(s), ${parsed.syscalls.length} syscall(s) in ${dt}ms`,
    );
  } else {
    broadcast("s2c.ui.busy", { windowId, busy: false });
    log.warn(
      `⚠ ${app.name} [${windowId.slice(-6)}] no HTML returned (ok=${result.ok}, text ${result.text.length} chars) in ${dt}ms`,
    );
    if (!result.ok) {
      broadcast("s2c.error", {
        code: "ai_failed",
        detail: result.error,
        windowId,
      });
    }
  }

  if (parsed.summary) {
    await saveSummary(windowId, parsed.summary);
    log.debug(`  summary: ${parsed.summary}`);
  }

  // Record what this run produced, for the Activity Monitor.
  const what =
    parsed.summary ||
    (parsed.html !== undefined
      ? "Rendered full window"
      : parsed.regions?.length
        ? `Patched ${parsed.regions.length} region(s)`
        : "No output");
  await recordSummary(result.runId, what);

  if (parsed.syscalls.length > 0) {
    log.debug(`  syscalls: ${parsed.syscalls.map((c) => c.type).join(", ")}`);
    await Syscalls.execute(parsed.syscalls, { windowId, appId: app.id, source: "syscall" });
  }
}
