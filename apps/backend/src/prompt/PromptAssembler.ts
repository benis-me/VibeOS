import type { AppDescriptor, ProfileEntry } from "@vibeos/shared/domain";
import type { AiOp, DragPayload } from "@vibeos/shared/protocol";
import type { AppMemory, Interaction } from "@vibeos/shared/domain";
import { presetHint } from "./presetTemplates.ts";
import { env } from "../config/env.ts";

const SUMMARY_BUDGET = 1200;

/**
 * - "force-full": the OS is certain a full render is needed (first paint,
 *   spawned window, or no patchable snapshot yet). Not negotiable.
 * - "prefer-incremental": a normal interaction on an already-rendered window.
 *   The OS *suggests* incremental, but the AI — which understands the semantics
 *   of the action — may upgrade to a full render when the change is structural
 *   (a page navigation, a tab switch that replaces everything, etc.).
 */
export type RenderMode = "force-full" | "prefer-incremental";

export interface AssembleInput {
  app: AppDescriptor;
  memory: AppMemory | null;
  recent: Interaction[];
  globalState: Record<string, unknown>;
  /** Current inner size of the window, so the AI lays out responsively. */
  windowSize?: { w: number; h: number };
  op?: AiOp;
  drag?: DragPayload;
  /** Seed instruction for an AI-spawned popup window. */
  seedPrompt?: string;
  firstRender: boolean;
  /** Decided by the backend BEFORE calling the AI — not left to the model. */
  renderMode: RenderMode;
  /** The data-vibeos-region ids present in the current snapshot (for incremental). */
  regionIds?: string[];
  /** Only enabled entries are included; an empty/disabled list adds no profile context. */
  profileEntries?: readonly ProfileEntry[];
}

/**
 * Pre-decide the render mode before the AI runs. The OS only *forces* full when
 * it's structurally unavoidable; otherwise it nudges toward incremental but
 * lets the AI (which knows the action's intent) make the final call.
 */
export function decideRenderMode(input: {
  firstRender: boolean;
  hasSnapshot: boolean;
  hasRegions: boolean;
  isSpawn: boolean;
}): RenderMode {
  if (input.firstRender || input.isSpawn || !input.hasSnapshot || !input.hasRegions) {
    return "force-full";
  }
  return "prefer-incremental";
}

export function assemblePrompt(input: AssembleInput): string {
  const {
    app,
    memory,
    recent,
    globalState,
    windowSize,
    op,
    drag,
    seedPrompt,
    firstRender,
    renderMode,
    regionIds,
    profileEntries,
  } = input;
  const parts: string[] = [];

  const gs: Record<string, unknown> = { ...compact(globalState) };
  if (windowSize) gs.windowSize = `${Math.round(windowSize.w)}x${Math.round(windowSize.h)}px`;
  parts.push(`[GLOBAL STATE]\n${JSON.stringify(gs, null, 0)}`);

  const enabledProfiles = (profileEntries ?? []).filter((e) => e.enabled && e.content.trim());
  if (enabledProfiles.length) {
    parts.push(
      `[USER PROFILE]\nPreferences the user enabled — apply where relevant (don't echo them verbatim):\n${enabledProfiles.map((e, i) => `${i + 1}. ${e.content.trim()}`).join("\n\n")}`,
    );
  }

  parts.push(
    `[APP]\nname: ${app.name}\nkind: ${app.kind}${app.presetId ? `\npreset: ${app.presetId}` : ""}` +
      (app.manifest.description ? `\nabout: ${app.manifest.description}` : ""),
  );

  const hint = presetHint(app.presetId);
  if (hint) parts.push(`[APP STYLE GUIDE]\n${hint}`);

  if (app.manifest.chrome) parts.push(chromeDirective(String(app.manifest.chrome)));

  if (memory?.episodeSummary) {
    parts.push(`[EPISODE MEMORY]\n${truncate(memory.episodeSummary, SUMMARY_BUDGET)}`);
  }

  if (recent.length > 0) {
    const lines = recent
      .map(
        (r) =>
          `- ${r.opKind} ${summarizeOp(r.opPayload)}${r.resultSummary ? ` → ${r.resultSummary}` : ""}`,
      )
      .join("\n");
    parts.push(`[RECENT INTERACTIONS]\n${lines}`);
  }

  if (!firstRender && memory?.htmlSnapshot) {
    // Stateless ui-gen → send the FULL current UI every op (no cap by default).
    const snap =
      env.snapshotBudget > 0
        ? truncateHtml(memory.htmlSnapshot, env.snapshotBudget)
        : memory.htmlSnapshot;
    parts.push(`[CURRENT UI]\n${snap}`);
  }

  // What happened.
  let opLine: string;
  if (seedPrompt) {
    opLine = `This is a new window opened by the system, for the following purpose:\n${seedPrompt}`;
  } else if (firstRender) {
    opLine = `The user just launched this application.`;
  } else if (drag) {
    opLine = `The user dropped a ${drag.kind} (${drag.label ?? drag.ref}) onto this window. React to it.`;
  } else if (op) {
    opLine =
      `The user performed: ${op.kind}` +
      (op.action ? ` action="${op.action}"` : "") +
      // The clicked element's label/text — crucial for distinguishing controls
      // that share an action (e.g. which calculator key, which list row).
      (op.sel ? ` target="${op.sel}"` : "") +
      (op.value !== undefined ? ` value="${op.value}"` : "") +
      (op.dataset && Object.keys(op.dataset).length ? ` data=${JSON.stringify(op.dataset)}` : "") +
      (op.formData ? ` form=${JSON.stringify(op.formData)}` : "") +
      (op.regionPath?.length
        ? ` regionPath=${JSON.stringify(op.regionPath)} (nearest first; other affected regions may also change)`
        : "");
  } else {
    opLine = `Update the interface.`;
  }

  // Render-mode directive: the OS decides the BASELINE, the AI decides edge cases.
  const modeDirective =
    renderMode === "force-full"
      ? `[RENDER MODE: FULL]\nReturn the COMPLETE window body in <vibeos-html mode="full">. Tag separate, updatable parts with unique data-vibeos-region="<stable-id>" so future changes can be patched incrementally. Do NOT return bare region fragments this time.`
      : `[RENDER MODE: INCREMENTAL PREFERRED]\nThe window is already rendered (see CURRENT UI${
          regionIds?.length ? `, regions: ${regionIds.join(", ")}` : ""
        }). DECIDE which fits this action:
- If the action changes only part(s) of the screen → use <vibeos-html mode="regions"> and return ONLY those existing data-vibeos-region elements (for accumulating regions like terminal/chat/list, include ALL their existing content plus the new part). This is the default — prefer it.
- To insert/delete a region or change its layout, replace its existing parent region. Never return both an ancestor and its descendant, never invent a target id. Leave unrelated input and scroll regions untouched.
- If the action structurally replaces the screen (page navigation, switching to a totally different view) → use <vibeos-html mode="full"> with the FULL body instead.
Choose deliberately before you write: do not re-emit the whole window for a small change, and do not emit a fragment when the layout truly changed.`;

  parts.push(`[OPERATION]\n${opLine}\n\n${modeDirective}`);

  return parts.join("\n\n");
}

/** Per-app instructions when the OS provides a native chrome shell. */
function chromeDirective(chrome: string): string {
  if (chrome === "browser") {
    return `[NATIVE CHROME: browser]
This window has a NATIVE address bar provided by the OS (back / forward / reload / URL field). You generate ONLY the page CONTENT below it — do NOT draw an address bar, toolbar, tabs, or any browser chrome yourself.
- Navigation arrives as an OPERATION with action="navigate" and the target in value/form (a URL or a search query). Render that page's content.
- A clicked link or anything that changes the page is also an OPERATION — render the new page.
- WHENEVER the shown page changes (navigation, clicked link, redirect, search) you MUST emit a chrome syscall so the address bar stays in sync:
\`\`\`vibeos-syscall
{ "calls": [ { "type": "chrome", "set": { "url": "https://example.com/path", "title": "Page title" } } ] }
\`\`\``;
  }
  return `[NATIVE CHROME: ${chrome}]\nThis window has a native shell provided by the OS; generate ONLY the inner content. Update the shell when the content's state changes via a chrome syscall: { "type":"chrome", "set": { ... } }.`;
}

function compact(state: Record<string, unknown>): Record<string, unknown> {
  // Keep the prompt small; drop anything large.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    const s = JSON.stringify(v);
    if (s && s.length < 800) out[k] = v;
  }
  return out;
}

function summarizeOp(payload: unknown): string {
  try {
    const s = JSON.stringify(payload);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

/**
 * Truncate an HTML snapshot for context. Cuts at the last COMPLETE tag boundary
 * before `max` so the AI never sees a half-open tag, and marks the elision —
 * noting that unchanged regions are preserved automatically, so the model
 * shouldn't try to reconstruct the parts it can't see.
 */
function truncateHtml(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const lastClose = head.lastIndexOf(">");
  const cut = lastClose > max * 0.6 ? head.slice(0, lastClose + 1) : head;
  return `${cut}\n<!-- …[${s.length - cut.length} chars truncated; regions you don't see here are kept as-is — only re-emit a data-vibeos-region you actually change] -->`;
}
