// Isolated storage regression, invoked by appWorkflow.test.ts.
import assert from "node:assert/strict";
import { getDb, closeDb } from "../apps/backend/src/db/database.ts";
import { migrate } from "../apps/backend/src/db/migrate.ts";
import { ensureDiskLayout } from "../apps/backend/src/files/content.ts";
import { ensureSettings } from "../apps/backend/src/db/repositories/SettingsRepo.ts";
import { installApp, getApp } from "../apps/backend/src/db/repositories/AppRepo.ts";
import * as A from "../apps/backend/src/db/repositories/ApplicationRepo.ts";
import * as W from "../apps/backend/src/db/repositories/WindowRepo.ts";
import * as M from "../apps/backend/src/db/repositories/AppMemoryRepo.ts";
import * as P from "../apps/backend/src/db/repositories/ApplicationPackageRepo.ts";
import { applicationDefinitionSchema, viewStateSchema } from "@vibeos/shared";
import { runtimeMessageSchema } from "@vibeos/shared/protocol";
import { parseApplicationOutput } from "../apps/backend/src/ai/applications.ts";
import { runtimeGuide } from "../apps/backend/src/prompt/runtimeGuide.ts";

migrate(getDb());
ensureDiskLayout();
await ensureSettings();
const source =
  '<main data-vibeos-region="root"><button data-vibeos-local=\'{"action":"toggle","target":"details"}\'>Details</button><aside data-vibeos-local-id="details" hidden>Preview</aside><script type="application/vibeos" data-vibeos-script="timer">const deadline=vibe.state().deadline||Date.now()+60000; vibe.setState({deadline}); return ()=>{};</script></main>';
await P.validateApplicationHtml(source, "interactive");
const metadata = { summary: "Ready", definition: { runtime: "interactive" } };
const authored =
  "```vibeos-application\n" +
  JSON.stringify(metadata) +
  '\n```\n<vibeos-html mode="full">' +
  source +
  "</vibeos-html>";
assert.equal(parseApplicationOutput(authored).definition.seedHtml, source);
assert.equal(parseApplicationOutput("Ready.\n\n" + authored).definition.seedHtml, source);
assert.equal(
  parseApplicationOutput(
    JSON.stringify({
      ...metadata,
      definition: { ...metadata.definition, seedHtml: source },
    }),
  ).definition.seedHtml,
  source,
);
assert.throws(() => parseApplicationOutput(authored.replace("</vibeos-html>", "")));
for (const invalid of [
  source.replace('type="application/vibeos"', 'type="text/javascript"'),
  source.replace('data-vibeos-script="timer"', 'data-vibeos-script="timer" src="/external.js"'),
  source.replace("const deadline=", "const broken = ; const deadline="),
  source + source,
  source.replace("</script>", ""),
  source.replace("const deadline=", "window.__mustNeverExecute = true; const deadline="),
]) {
  if (invalid.includes("__mustNeverExecute")) {
    await P.validateApplicationHtml(invalid, "interactive");
    assert.equal(
      (globalThis as any).__mustNeverExecute,
      undefined,
      "validation never executes code",
    );
  } else await assert.rejects(P.validateApplicationHtml(invalid, "interactive"));
}
await assert.rejects(P.validateApplicationHtml(source, "html"));
assert.equal(applicationDefinitionSchema.parse({}).runtime, "html");
await P.validateApplicationHtml('<meta charset="utf-8">' + source, "interactive");
await assert.rejects(
  P.validateApplicationHtml(
    '<meta http-equiv="refresh" content="0;url=https://example.com">' + source,
    "interactive",
  ),
);
assert(!viewStateSchema.safeParse({ text: "汉".repeat(6000) }).success);
assert(!viewStateSchema.safeParse({ constructor: { prototype: { bad: true } } }).success);
assert(!viewStateSchema.safeParse({ text: "x".repeat(17000) }).success);
assert(
  !runtimeMessageSchema.safeParse({
    type: "command",
    windowId: "other",
    id: "1",
    command: { action: "refresh" },
  }).success,
  "frame cannot supply identity",
);
assert(
  runtimeMessageSchema.safeParse({
    type: "command",
    id: "1",
    command: { action: "refresh" },
  }).success,
);
assert(runtimeGuide("html").includes("script-free"));
assert(runtimeGuide("interactive").includes("vibe.command"));
await assert.rejects(
  installApp({
    name: "Rejected script",
    manifest: {
      runtime: "interactive",
      seedHtml: source.replace("const deadline=", "const = ; const deadline="),
    },
  }),
);
const app = await installApp({ name: "Runtime versions" });
const classic = await W.openWindow({ appId: app.id, title: app.name });
await M.ensureMemory(classic.id, app.id);
assert.equal(classic.runtime, "html");
const request = await A.startApplicationRequest(
  app.id,
  "Enable local interactions",
  undefined,
  "interactive",
);
const definition = applicationDefinitionSchema.parse({
  runtime: "interactive",
  seedHtml: source,
  instructions: "Keep semantic actions AI generated.",
});
await A.publishApplicationVersion(
  request.id,
  definition,
  "Interactive version",
  undefined,
  new AbortController().signal,
);
const interactive = await W.openWindow({ appId: app.id, title: app.name });
await M.ensureMemory(interactive.id, app.id);
assert.equal(interactive.runtime, "interactive");
assert.equal(W.getWindow(classic.id)?.runtime, "html", "open versions never upgrade implicitly");
await W.saveViewState(interactive.id, interactive.appVersionId, {
  deadline: 1234,
  selected: "a",
});
await W.saveViewState(interactive.id, classic.appVersionId, { deadline: 0 });
assert.equal(
  W.getWindow(interactive.id)?.viewState?.deadline,
  1234,
  "stale version cannot overwrite local state",
);
const before = A.getAppData(app.id);
await M.saveSnapshot(interactive.id, source, undefined, before.version);
assert.equal(W.getWindow(interactive.id)?.snapshotDataVersion, before.version);
await A.setAppData(app.id, {
  version: before.version,
  data: { items: [{ id: "a", title: "Actual" }] },
});
assert.equal(
  await M.saveSnapshot(interactive.id, "stale", undefined, before.version),
  false,
  "stale generated data never publishes",
);
assert.equal(M.getSnapshot(interactive.id), source);
const pack = P.exportApplication(app.id, true);
assert.equal(JSON.parse(pack).vibeapp, 3);
assert.equal(JSON.parse(pack).definition.runtime, "interactive");
const imported = await P.importApplication(pack);
assert.equal(A.readApplicationVersion(imported.id)?.runtime, "interactive");
assert.deepEqual(A.getAppData(imported.id).data, A.getAppData(app.id).data);
await assert.rejects(P.importApplication(pack.replace('"vibeapp": 3', '"vibeapp": 2')));
const copied = await A.duplicateApplication(app.id, "Runtime copy");
assert.equal(A.readApplicationVersion(copied.id)?.runtime, "interactive");
await A.activateApplicationVersion(app.id, classic.appVersionId!);
assert.equal(getApp(app.id)?.manifest.runtime, "html");
assert.equal(
  W.getWindow(interactive.id)?.runtime,
  "interactive",
  "rollback leaves open enhanced versions intact",
);
const oldPack = JSON.parse(P.exportApplication(app.id));
assert.equal(oldPack.vibeapp, 2);
assert.equal(oldPack.definition.runtime, undefined, "classic exports remain backward compatible");
closeDb();
assert.equal(W.getWindow(interactive.id)?.viewState?.deadline, 1234);
assert.equal(W.getWindow(interactive.id)?.runtime, "interactive");
await W.closeWindow(interactive.id);
await W.saveViewState(interactive.id, interactive.appVersionId, {
  deadline: 0,
});
assert.equal(
  W.getWindow(interactive.id)?.viewState?.deadline,
  1234,
  "closed frames cannot persist late writes",
);
closeDb();
console.log(
  "Interactive runtime passed: validation, version pinning, data revisions, local persistence, export/import, duplicate and rollback",
);
