import {
  applicationCommandSchema,
  applicationOutputSchema,
  type ApplicationCommand,
  type AppRuntime,
} from "@vibeos/shared/domain";
import { run, recordSummary, recordStep } from "./SdkManager.ts";
import { getImageForServe, rewriteImages } from "./imageCache.ts";
import { getApp, installApp, listApps } from "../db/repositories/AppRepo.ts";
import * as Applications from "../db/repositories/ApplicationRepo.ts";
import { parseSubscriptions } from "../db/repositories/CommunicationRepo.ts";
import { getSnapshot } from "../db/repositories/AppMemoryRepo.ts";
import { ensureShortcut, createNode } from "../db/repositories/VfsRepo.ts";
import { broadcast } from "../server/wsGateway.ts";
import { broadcastDiskChanges } from "../server/filesHandlers.ts";
import { COMMUNICATION_GUIDE } from "../prompt/PromptAssembler.ts";
import { runtimeGuide } from "../prompt/runtimeGuide.ts";
import { parseAiOutput } from "./streamParser.ts";
import {
  validateApplicationHtml,
  exportApplication,
  importApplication,
} from "../db/repositories/ApplicationPackageRepo.ts";
import { learnFromUser } from "./systemMemory.ts";
import { uninstallApplication, updateApplicationWindow } from "../server/applicationLifecycle.ts";

const jobs = new Map<string, AbortController>();
export function broadcastApplications() {
  broadcast("s2c.apps.changed", { apps: listApps(true) });
  broadcast("s2c.application.state", Applications.applicationState());
}

export async function handleApplicationCommand(
  input: ApplicationCommand,
): Promise<{ appId?: string; path?: string }> {
  const command = applicationCommandSchema.parse(input);
  let appId = "appId" in command ? command.appId : undefined;
  let path: string | undefined;
  switch (command.action) {
    case "state":
      break;
    case "create": {
      const app = await installApp({
        name: command.name,
        manifest: {
          description: command.prompt ?? command.name,
          instructions: command.prompt ?? command.name,
        },
      });
      appId = app.id;
      await ensureShortcut(app.id, app.name, app.icon);
      if (command.prompt?.trim()) await startGeneration(app.id, command.prompt);
      break;
    }
    case "rename":
      await Applications.renameApplication(command.appId, command.name);
      break;
    case "duplicate": {
      const app = await Applications.duplicateApplication(command.appId, command.name);
      appId = app.id;
      await ensureShortcut(app.id, app.name, app.icon);
      break;
    }
    case "uninstall":
      for (const [id, abort] of jobs)
        if (Applications.getApplicationRequest(id)?.app_id === command.appId) abort.abort();
      await uninstallApplication(command.appId);
      break;
    case "clear-data":
      broadcast("s2c.appData.changed", await Applications.clearApplicationData(command.appId));
      break;
    case "activate":
      await Applications.activateApplicationVersion(command.appId, command.versionId);
      break;
    case "generate":
      await startGeneration(command.appId, command.prompt, command.sourceWindowId, command.runtime);
      break;
    case "cancel": {
      jobs.get(command.requestId)?.abort();
      await Applications.updateApplicationRequest(command.requestId, "cancelled");
      break;
    }
    case "update-window":
      await updateApplicationWindow(command.windowId);
      break;
    case "export": {
      const app = getApp(command.appId);
      if (!app) throw new Error("applications.error.missing");
      const node = await createNode({
        name: `${app.name}.vibeapp`,
        type: "file",
        mime: "application/vibeapp+json",
        content: exportApplication(app.id, command.includeData),
        location: "desktop",
      });
      path = String(node.meta.diskPath);
      broadcast("s2c.syscall.fileCreated", { node });
      break;
    }
    case "import":
      appId = (await importApplication(command.json)).id;
      break;
  }
  broadcastApplications();
  if (command.action !== "state") await broadcastDiskChanges();
  return { appId, path };
}

async function startGeneration(
  appId: string,
  prompt: string,
  sourceWindowId?: string,
  runtime?: AppRuntime,
) {
  const request = await Applications.startApplicationRequest(
    appId,
    prompt,
    sourceWindowId,
    runtime,
  );
  const abort = new AbortController();
  jobs.set(request.id, abort);
  learnFromUser(prompt, "Application editor");
  void generate(request.id, abort).finally(() => jobs.delete(request.id));
}

async function generate(requestId: string, abort: AbortController) {
  const request = Applications.getApplicationRequest(requestId)!;
  const app = getApp(request.app_id)!;
  let chars = 0,
    lastProgress = 0;
  const progress = async (status: "generating" | "validating") => {
    if (
      !["generating", "validating"].includes(
        Applications.getApplicationRequest(requestId)?.status ?? "",
      )
    )
      abort.abort();
    abort.signal.throwIfAborted();
    await Applications.updateApplicationRequest(requestId, status, chars);
    broadcast("s2c.application.state", Applications.applicationState());
  };
  try {
    const definition = Applications.readApplicationVersion(app.id, request.base_version_id)!;
    const source = request.source_window_id ? getSnapshot(request.source_window_id) : "";
    const data = Applications.getAppData(app.id);
    let prompt = `[VIBEOS_APP_REQUEST]\nAPP: ${app.name}\nBASE DEFINITION: ${JSON.stringify(definition)}\nSHARED DATA: ${JSON.stringify(data)}\n${source ? "REFERENCE WINDOW (preserve its original separately; do not copy private records into the new startup UI):\\n" + source : ""}\nUSER REQUEST: ${request.prompt}`;
    const systemPrompt = `You design a persistent, local AI-hallucination-driven VibeOS application. It continues generating at runtime, not a fixed JavaScript app. Implement the user's change fully, retaining the cumulative purpose and prior requirements in instructions. Think through a distinctive, complete layout, useful controls, empty/error/loading states and real data continuity before output.
  Return TWO blocks, in this order:
  1. A fenced block tagged vibeos-application with JSON {"summary":"short user-facing change summary","definition":{"runtime":"${request.runtime}","description":"short purpose","instructions":"concise durable behavior and imaginative intent, data structure and AI actions","defaultSize":{"w":760,"h":520},"fileTypes":[],"operations":[],"dataSchemaVersion":1,"assets":{}}}. Keep instructions concise; describe semantics and data, do not repeat markup/CSS. operations is an array of objects {"topic":"file.open","description":"semantic handling of an incoming file"}, NEVER strings or permissions. Use [] when no incoming app topic is handled. Close every JSON object. Do NOT put seedHtml or escaped HTML in this JSON.
  2. <vibeos-html mode="full">your complete startup HTML fragment, CSS and permitted inert scripts, as raw text</vibeos-html>. No outer html/head/body, no extra code fence, no syscall block at authoring time.
  The first block MAY additionally contain migratedData, but ONLY for an actual schema change or lossless legacy record extraction. For a new app or ordinary edit OMIT migratedData entirely. It is the plain application data, NOT the {appId,version,schemaVersion,data} service envelope. Preserve every existing record and unknown field; never add example records. Retain schema version for compatible changes. If schema changes, provide complete lossless migrated data with a new schema version.
  Use declarative local controls for tabs/details and ordinary data-vibeos-action buttons for all AI business work. Do not implement your own plan/list renderer, shared-data synchronization or file exporter in JavaScript. Bind scalar values and let runtime AI render collections from canonical data. Usually only the timer/Canvas needs a script; aim for one small readable block, below 80 lines, with no unnecessary wrappers.
  HTML follows the selected runtime below; no ordinary scripts, inline event handlers, iframe, external libraries or page reloads. It fills height:100% with a flex column; use native semantic HTML, aria labels, inline SVG icons, no emoji. Use VibeOS CSS variables (--background, --foreground, --card, --muted, --muted-foreground, --border, --brand, --brand-foreground); remain skin-neutral. Do not draw window chrome. Give separate sections stable data-vibeos-region IDs. Controls use data-vibeos-action; the runtime AI interprets them. Optional data-vibeos-command uses the documented protocol for deterministic operations. Bind plain data using data-vibeos-bind="appData.data.field"; collection layouts can subscribe to app.data.changed with source {"appId":"self"}, mode:"ai" and rebuild only the affected region. The startup HTML must be an EMPTY reusable template, never contain personal records, private file paths or the reference window's input values. Durable data belongs to the app-data service. Describe the data structure and runtime behavior in instructions. Only claim actual file success after real service replies. Include fileTypes and file.open if the application can process files, with meaningful semantic processing instructions. Keep fictional world data explicitly fictional; persist its evolving discoveries as app data.
  Existing image IDs may be retained; assets maps a stable name to its actual existing /api/img ID. Never invent image IDs. All references must be self-contained local /api/img/<id> resources or inline SVG.
  Selected definition.runtime MUST be ${request.runtime}. ${runtimeGuide(request.runtime)}\nThe following documents RUNTIME behavior, not the output format for this authoring request:\n${COMMUNICATION_GUIDE}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      abort.signal.throwIfAborted();
      await progress("generating");
      const result = await run({
        role: "ui-generation",
        trigger: "user",
        appName: app.name,
        appId: app.id,
        traceId: request.id,
        systemPromptOverride: systemPrompt,
        prompt,
        abort,
        onDelta(delta) {
          chars += delta.length;
          if (Date.now() - lastProgress > 500) {
            lastProgress = Date.now();
            void progress("generating").catch(() => {});
          }
        },
      });
      abort.signal.throwIfAborted();
      if (!result.ok) throw new Error(result.error ?? "applications.error.generation");
      await progress("validating");
      try {
        const output = parseApplicationOutput(result.text);
        output.definition.runtime = request.runtime;
        await validateApplicationHtml(output.definition.seedHtml, request.runtime);
        await parseSubscriptions(output.definition.seedHtml);
        output.definition.seedHtml = rewriteImages(output.definition.seedHtml);
        for (const match of output.definition.seedHtml.matchAll(/\/api\/img\/([a-zA-Z0-9_-]+)/g)) {
          if (!(await getImageForServe(match[1]!))) throw new Error("applications.error.asset");
          output.definition.assets[match[1]!] = match[1]!;
        }
        abort.signal.throwIfAborted();
        if (
          await Applications.publishApplicationVersion(
            requestId,
            output.definition,
            output.summary,
            output.migratedData,
            abort.signal,
          )
        ) {
          await recordSummary(result.runId, output.summary);
          broadcast("s2c.appData.changed", Applications.getAppData(app.id));
        }
        break;
      } catch (error) {
        const reason =
          error instanceof Error
            ? `${error.message}${error.cause ? `: ${String(error.cause)}` : ""}`
            : "invalid output";
        await recordStep(
          "application.rejected",
          { appId: app.id, error: reason },
          { id: request.id, runId: result.runId },
          "error",
        );
        if (attempt === 1 || abort.signal.aborted) throw error;
        prompt += `\nThe candidate did not validate and was not saved. Fix this error and return both complete blocks: ${reason}\nREJECTED CANDIDATE:\n${result.text}`;
      }
    }
  } catch (error) {
    await Applications.updateApplicationRequest(
      requestId,
      abort.signal.aborted ? "cancelled" : "failed",
      chars,
      error instanceof Error ? error.message : "applications.error.generation",
    );
  } finally {
    broadcastApplications();
  }
}

/** Raw HTML avoids an extra JSON escaping layer for generated CSS and JS. */
export function parseApplicationOutput(text: string) {
  const raw = text.trim();
  const metadata = /(?:^|\n)[ \t]*```vibeos-application\s*\n([\s\S]*?)\n[ \t]*```/.exec(raw);
  if (!metadata)
    return applicationOutputSchema.parse(
      JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")),
    );
  const meta = JSON.parse(metadata[1]!);
  const markup = raw
    .slice(metadata.index + metadata[0].length)
    .trim()
    .replace(/^```(?:html)?\s*\n/i, "")
    .replace(/\n```\s*$/, "");
  const parsed = parseAiOutput(markup, "full");
  if (!parsed.html || parsed.renderError || parsed.syscallError || parsed.syscalls.length)
    throw new Error("applications.error.html");
  return applicationOutputSchema.parse({
    ...meta,
    definition: { ...meta.definition, seedHtml: parsed.html },
  });
}
