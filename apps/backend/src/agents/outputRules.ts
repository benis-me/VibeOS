import type { AppRuntime } from "@vibeos/shared";
import type { ParsedAiOutput } from "@vibeos/shared/prompt";
import { validateRuntimeScripts } from "../db/repositories/ApplicationPackageRepo.ts";
import { parseSubscriptions } from "../db/repositories/CommunicationRepo.ts";
import { applyRegionsServer } from "./regionMerge.ts";

/** A rejected model output; `full` when only a complete window body can repair it. */
export class OutputRejected extends Error {
  constructor(
    message: string,
    readonly full = false,
  ) {
    super(message);
  }
}

/**
 * Every rule a model output must pass before anything is applied. Broken HTML
 * structure needs the complete body; any other problem keeps the render mode.
 */
export async function validateOutput(
  parsed: ParsedAiOutput,
  context: {
    snapshot: string;
    fullRequired: boolean;
    readOnlyRefresh: boolean;
    runtime: AppRuntime;
  },
): Promise<{ html?: string; regions?: ParsedAiOutput["regions"] }> {
  if (parsed.syscallError || parsed.renderError)
    throw new OutputRejected(
      [parsed.syscallError, parsed.renderError].filter(Boolean).join("; "),
      !!parsed.renderError,
    );
  let html: string | undefined;
  const regions = parsed.regions;
  if (regions?.length) {
    if (context.fullRequired) throw new OutputRejected("A complete window body is required", true);
    try {
      html = applyRegionsServer(context.snapshot, regions);
    } catch (error) {
      throw new OutputRejected(error instanceof Error ? error.message : String(error), true);
    }
  } else if (parsed.html !== undefined) {
    html = parsed.html;
  } else if (!parsed.syscalls.length && !(context.readOnlyRefresh && parsed.summary.trim())) {
    throw new OutputRejected("The model returned no UI or system action");
  }
  const stateCalls = parsed.syscalls.filter((call) => call.type === "app-state");
  const needsState =
    (!context.readOnlyRefresh && html !== undefined) ||
    parsed.syscalls.some((call) => call.type === "notify" || call.type === "spawn-window");
  if (stateCalls.length > 1 || (needsState && stateCalls.length !== 1))
    throw new OutputRejected(
      "Declare exactly one app-state call: provide the complete shared data for record changes, or omit data for a view-only change. A notification or completed-looking HTML does not persist application state.",
    );
  const explicitStateWrite = parsed.syscalls.some(
    (call) =>
      call.type === "communication" &&
      call.command.action === "request" &&
      "system" in call.command.target &&
      call.command.target.system === "app-data" &&
      call.command.topic === "set",
  );
  if (
    context.readOnlyRefresh &&
    (stateCalls.some((call) => call.data !== undefined) || explicitStateWrite)
  )
    throw new OutputRejected(
      "app.data.changed only refreshes the view; use app-state without data and never repeat the mutation.",
    );
  if (explicitStateWrite && stateCalls.some((call) => call.data !== undefined))
    throw new OutputRejected(
      "Use one state write: app-state or app-data set, never both in one response.",
    );
  if (html !== undefined) {
    await validateRuntimeScripts(html, context.runtime);
    await parseSubscriptions(html);
  }
  return { html, regions };
}
