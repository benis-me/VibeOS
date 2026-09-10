import {
  applicationCommandSchema,
  applicationOutputSchema,
  type ApplicationCommand,
} from "@vibeos/shared/domain";
import { run, recordSummary } from "./SdkManager.ts";
import { getImageForServe, rewriteImages } from "./imageCache.ts";
import { getApp, installApp, listApps } from "../db/repositories/AppRepo.ts";
import * as Applications from "../db/repositories/ApplicationRepo.ts";
import { parseSubscriptions } from "../db/repositories/CommunicationRepo.ts";
import { getSnapshot } from "../db/repositories/AppMemoryRepo.ts";
import { ensureShortcut, createNode } from "../db/repositories/VfsRepo.ts";
import { broadcast } from "../server/wsGateway.ts";
import { broadcastDiskChanges } from "../server/filesHandlers.ts";
import { COMMUNICATION_GUIDE } from "../prompt/PromptAssembler.ts";
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
  broadcast("s2c.files.changed", { paths: ["Applications"] });
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
      await startGeneration(command.appId, command.prompt, command.sourceWindowId);
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

async function startGeneration(appId: string, prompt: string, sourceWindowId?: string) {
  const request = await Applications.startApplicationRequest(appId, prompt, sourceWindowId);
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
  Return ONLY JSON {"summary":"short user-facing change summary","definition":{"description":"short purpose","instructions":"durable behavior and imaginative intent, including data handling","seedHtml":"complete HTML startup body","defaultSize":{"w":760,"h":520},"fileTypes":[".md"],"operations":[{"topic":"file.open","description":"what to do with the real file"}],"dataSchemaVersion":1,"assets":{}},"migratedData":{}}. migratedData is OPTIONAL: omit for normal edits; supply only when upgrading legacy snapshot records into shared data or changing the schema. Preserve every existing record, including unknown fields. Never replace real records with examples. Retain schema version for compatible changes. If schema changes, provide the complete lossless migrated data with a new schema version.
  HTML must be script-free: no scripts, event handlers, iframe, external libraries or page reloads. It fills height:100% with a flex column; use native semantic HTML, aria labels, inline SVG icons, no emoji. Use VibeOS CSS variables (--background, --foreground, --card, --muted, --muted-foreground, --border, --brand, --brand-foreground); remain skin-neutral. Do not draw window chrome. Give separate sections stable data-vibeos-region IDs. Controls use data-vibeos-action; the runtime AI interprets them. Optional data-vibeos-command uses the documented protocol for deterministic operations. Bind plain data using data-vibeos-bind="appData.data.field"; collection layouts can subscribe to app.data.changed with source {"appId":"self"}, mode:"ai" and rebuild only the affected region. The startup HTML must be an EMPTY reusable template, never contain personal records, private file paths or the reference window's input values. Durable data belongs to the app-data service. Describe the data structure and runtime behavior in instructions. Only claim actual file success after real service replies. Include fileTypes and file.open if the application can process files, with meaningful semantic processing instructions. Keep fictional world data explicitly fictional; persist its evolving discoveries as app data.
  Existing image IDs may be retained; assets maps a stable name to its actual existing /api/img ID. Never invent image IDs. All references must be self-contained local /api/img/<id> resources or inline SVG.
  The following documents RUNTIME behavior, not the output format for this authoring request:\n${COMMUNICATION_GUIDE}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      abort.signal.throwIfAborted();
      await progress("generating");
      const result = await run({
        role: "ui-generation",
        trigger: "user",
        appName: app.name,
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
        const output = applicationOutputSchema.parse(
          JSON.parse(
            result.text
              .trim()
              .replace(/^```(?:json)?\s*/i, "")
              .replace(/\s*```$/, ""),
          ),
        );
        await validateApplicationHtml(output.definition.seedHtml);
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
        if (attempt === 1 || abort.signal.aborted) throw error;
        prompt += `\nThe candidate did not validate and was not saved. Fix this error and return the complete JSON: ${error instanceof Error ? error.message : "invalid output"}`;
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
