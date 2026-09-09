import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  compileSkin,
  emptySkinDefinition,
  skinDefinitionSchema,
  skinOutputSchema,
  isBuiltinSkin,
  type SkinDefinition,
} from "@vibeos/shared/domain";
import { parseClientMessage } from "@vibeos/shared/protocol";
import { getDb } from "../database.ts";
import { migrate } from "../migrate.ts";
import { ensureSettings, loadSettings } from "./SettingsRepo.ts";
import { getImage, putImage } from "./ImagesRepo.ts";
import { diskPath, executeDisk } from "../../files/disk.ts";
import * as skins from "./SkinRepo.ts";
import { handleSkinCommand } from "../../ai/skins.ts";

const definition = (brand: string): SkinDefinition => ({
  format: 1,
  light: { brand },
  dark: { brand: "#8ac9b7" },
  rules: [
    { target: "button", state: "hover", mode: "both", styles: { background: "var(--accent)" } },
  ],
});
test("skin boundary accepts only scoped appearance values and validated commands", () => {
  const valid = definition("oklch(0.4 0.12 160)");
  expect(compileSkin("devdock", valid)).toContain(
    ':root[data-custom-skin="devdock"] .ai-surface button:hover',
  );
  for (const unsafe of [
    "red;}body{display:none",
    "url(https://example.org/track)",
    "u\\72l(x)",
    "expression(alert(1))",
    "var(--unknown)",
    "red!important",
    "rgb(1 2 3",
    "red/*x*/",
  ]) {
    expect(skinDefinitionSchema.safeParse(definition(unsafe)).success).toBe(false);
  }
  expect(
    skinDefinitionSchema.safeParse({ ...valid, light: { "taskbar-h": "100vh" } }).success,
  ).toBe(false);
  expect(
    skinDefinitionSchema.safeParse({
      ...valid,
      rules: [{ target: "body", styles: { display: "none" } }],
    }).success,
  ).toBe(false);
  expect(
    skinDefinitionSchema.safeParse({
      ...valid,
      rules: [{ target: "window", styles: { position: "fixed" } }],
    }).success,
  ).toBe(false);
  for (const command of [
    { action: "generate", id: "../../file", prompt: "test" },
    { action: "create", name: " " },
    { action: "generate", id: "xp", prompt: "" },
  ])
    expect(
      parseClientMessage({ type: "c2s.skin.command", payload: { requestId: "request", command } }),
    ).toBeNull();
});

test("image skins compile local assets and geometry, reject broken references, and render legacy gradients", () => {
  const d = skinDefinitionSchema.parse({
    ...definition("#234"),
    chrome: { taskbarStyle: "dock" },
    assets: { grain: { prompt: "Seamless paper", aspect: "1:1", id: "a".repeat(32) } },
    rules: [
      { target: "titlebar", state: "unfocused", styles: { "background-image": "asset(grain)" } },
    ],
  });
  const css = compileSkin("xp", d, "http://localhost:7722");
  expect(css).toContain('url("http://localhost:7722/api/img/' + "a".repeat(32) + '")');
  expect(css).toContain(".vibe-window:not([data-focused]) .vibe-titlebar");
  expect(css).toContain("translateX(-50%)");
  expect(
    compileSkin("xp", { ...definition("#234"), light: { desktop: "linear-gradient(red, blue)" } }),
  ).toContain(".vibe-desktop{background:linear-gradient(red, blue)");
  expect(
    skinOutputSchema.safeParse({
      summary: "bad",
      definition: { ...d, light: { desktop: "linear-gradient(red, blue)" } },
    }).success,
  ).toBe(false);
  expect(skinDefinitionSchema.safeParse({ ...d, assets: {} }).success).toBe(false);
  expect(
    skinDefinitionSchema.safeParse({ ...d, chrome: { controlSize: 32, titlebarHeight: 28 } })
      .success,
  ).toBe(false);
  expect(
    skinDefinitionSchema.safeParse({
      ...d,
      rules: [{ target: "titlebar", styles: { color: "asset(grain)" } }],
    }).success,
  ).toBe(false);
  expect(() => compileSkin("xp", d, "javascript:alert(1)")).toThrow();
  const composed = {
    ...d,
    rules: [
      {
        target: "desktop",
        styles: { "background-image": "linear-gradient(#123, #456), asset(grain)" },
      },
    ],
  };
  expect(
    skinOutputSchema.safeParse({ summary: "hidden image", definition: composed }).success,
  ).toBe(false);
  composed.rules[0]!.styles["background-image"] = "asset(grain), linear-gradient(#123, #456)";
  expect(
    skinOutputSchema.safeParse({ summary: "visible image", definition: composed }).success,
  ).toBe(true);
});

test("skins keep immutable versions, fork selected versions, protect built-ins, and preserve data on failure/restart/delete races", async () => {
  migrate(getDb());
  await ensureSettings();
  for (const command of [
    { action: "rename", id: "xp", name: "Oops" },
    { action: "delete", id: "aqua" },
    { action: "generate", id: "devdock", prompt: "Overwrite" },
  ] as const)
    await expect(handleSkinCommand(command)).rejects.toThrow("skins.error.readonly");
  const id = await skins.createSkin("Paper test");
  expect(isBuiltinSkin(id)).toBe(false);
  expect(skins.getSkin(id)).toMatchObject({
    foundation: null,
    definition: emptySkinDefinition(),
    versions: [],
  });
  const source = await skins.createSkin("XP copy", "xp");
  expect(skins.getSkin(source).foundation).toBe("xp");
  const signal = new AbortController().signal;
  const first = await skins.startSkinRequest(id, "Green paper");
  await expect(skins.startSkinRequest(id, "Double click")).rejects.toThrow();
  expect(await skins.publishSkinVersion(first.id, definition("#2b6556"), "Green", signal)).toBe(
    true,
  );
  const v1 = skins.getSkin(id).versions[0]!;
  const file1 = diskPath(`System/Skins/${id}/Versions/${v1.id}.json`, true);
  const bytes1 = readFileSync(file1, "utf8");
  const second = await skins.startSkinRequest(id, "Blue paper");
  await skins.publishSkinVersion(second.id, definition("#245c9f"), "Blue", signal);
  await skins.activateSkin(id, v1.id);
  const third = await skins.startSkinRequest(id, "Refine the green version");
  expect(third.baseVersionId).toBe(v1.id);
  expect(skins.getSkin(id).definition.light.brand).toBe("#2b6556");
  await skins.activateSkin(id, skins.getSkin(id).versions[1]!.id);
  expect(skins.skinRequestDefinition(third).light.brand).toBe("#2b6556");
  await skins.publishSkinVersion(third.id, definition("#225549"), "Refined", signal);
  expect(skins.getSkin(id).versions.map((v) => v.number)).toEqual([1, 2, 3]);
  expect(readFileSync(file1, "utf8")).toBe(bytes1);
  expect(loadSettings().skin).toBe(id);
  const writeFailure = await skins.startSkinRequest(id, "Simulate failed settings publication");
  getDb().exec(
    "CREATE TRIGGER reject_skin_setting BEFORE UPDATE ON settings BEGIN SELECT RAISE(FAIL, 'test write failure'); END",
  );
  try {
    await expect(
      skins.publishSkinVersion(writeFailure.id, definition("red"), "Should roll back", signal),
    ).rejects.toThrow("test write failure");
  } finally {
    getDb().exec("DROP TRIGGER reject_skin_setting");
  }
  expect(skins.getSkin(id).versions).toHaveLength(3);
  expect(skins.getSkinRequest(writeFailure.id)?.status).toBe("generating");
  await skins.updateSkinRequest(writeFailure.id, "failed", 0);
  await skins.activateSkin(id, v1.id);
  const copy = await skins.createSkin("Independent copy", id);
  expect(skins.getSkin(copy).definition).toEqual(definition("#2b6556"));
  expect(skins.getSkin(copy).versions).toEqual([]);
  const failed = await skins.startSkinRequest(id, "Invalid output");
  await skins.updateSkinRequest(failed.id, "failed", 25, "Invalid JSON");
  expect(await skins.publishSkinVersion(failed.id, definition("red"), "Too late", signal)).toBe(
    false,
  );
  expect(skins.getSkin(id).activeVersionId).toBe(v1.id);
  const cancelled = await skins.startSkinRequest(id, "Cancel this");
  const abort = new AbortController();
  abort.abort();
  expect(
    await skins.publishSkinVersion(cancelled.id, definition("red"), "Cancelled", abort.signal),
  ).toBe(false);
  await skins.updateSkinRequest(cancelled.id, "cancelled", 0);
  const interrupted = await skins.startSkinRequest(id, "Restart this");
  await skins.recoverSkins();
  expect(skins.getSkinRequest(interrupted.id)?.status).toBe("interrupted");
  expect(skins.getSkin(id).activeVersionId).toBe(v1.id);
  // A damaged current file must not prevent selecting another valid version.
  writeFileSync(file1, "broken");
  expect(skins.skinState().skins.find((s) => s.id === id)?.loadError).toBe(true);
  await skins.activateSkin(id, skins.getSkin(id, true).versions[1]!.id);
  writeFileSync(file1, bytes1);
  const pending = await skins.startSkinRequest(id, "Delete during generation");
  await skins.deleteSkin(id);
  expect(await skins.publishSkinVersion(pending.id, definition("red"), "Deleted", signal)).toBe(
    false,
  );
  expect(loadSettings().skin).toBe("devdock");
  expect(existsSync(file1)).toBe(false);
  expect(
    executeDisk({ action: "list", path: "Trash" }).entries?.some(
      (e) => e.originalPath === `System/Skins/${id}`,
    ),
  ).toBe(true);
  expect(skins.getSkin(copy).definition.light.brand).toBe("#2b6556");
  await skins.renameSkin(copy, "Renamed copy");
  expect(skins.getSkin(copy).name).toBe("Renamed copy");
  await skins.deleteSkin(copy);
  await skins.deleteSkin(source);
});

test("a skin task produces a persisted version through SdkManager without any window or socket", async () => {
  migrate(getDb());
  await ensureSettings();
  const id = await handleSkinCommand({ action: "create", name: "Background stub" });
  await handleSkinCommand({ action: "generate", id, prompt: "Forest paper" });
  const deadline = Date.now() + 3000;
  while (!skins.getSkin(id).versions.length && Date.now() < deadline) await Bun.sleep(10);
  const skin = skins.getSkin(id);
  expect(skin.versions).toHaveLength(1);
  expect(skin.requests[0]?.status).toBe("succeeded");
  expect(skin.activeVersionId).toBe(skin.versions[0]!.id);
  expect(loadSettings().skin).toBe(id);
  await skins.deleteSkin(id);
});

test("skin provider pipeline repairs invalid output and survives failure, stop and immediate retry", () => {
  // A child keeps the real provider path separate from the suite's global offline stub.
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import assert from 'node:assert/strict';
    import { migrate } from './apps/backend/src/db/migrate.ts';
    import { getDb } from './apps/backend/src/db/database.ts';
    import { ensureSettings, updateSettings, loadSettings } from './apps/backend/src/db/repositories/SettingsRepo.ts';
    import { getSkin } from './apps/backend/src/db/repositories/SkinRepo.ts';
    import { handleSkinCommand } from './apps/backend/src/ai/skins.ts';
    import { ModelPolicy } from './apps/backend/src/ai/ModelPolicy.ts';
    import { requestSkinImage } from './apps/backend/src/ai/imageCache.ts';
    let mode = 'repair', calls = 0, imageCalls = 0, imageMode = 'ok', art = 'Paper';
    const output = JSON.stringify({summary:'Green',definition:{format:1,light:{brand:'#245c48'},dark:{brand:'#9ecbba'},rules:[]}});
    const server = Bun.serve({port:0,hostname:'127.0.0.1',async fetch(req) {
      const body = await req.json();
      if (new URL(req.url).pathname.endsWith('/images/generations')) {
        imageCalls++;
        if (imageMode === 'slow') await Bun.sleep(180);
        if (imageMode === 'empty-once') { imageMode='ok'; return Response.json({data:[]}); }
        if (imageMode === 'error') return new Response('failed', {status:500});
        return Response.json({data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0mIAAAAASUVORK5CYII='}]});
      }
      calls++;
      assert(!body.messages[0].content.includes('data-vibe-img'));
      assert(body.messages[0].content.includes('OWN SkinDefinition'));
      if (mode==='invalid') assert(body.messages.at(-1).content.includes('Generate green'));
      const imageOutput = JSON.stringify({summary:'Paper material',definition:{...JSON.parse(output).definition,assets:{paper:{prompt:art,aspect:'1:1'}},rules:[{target:'titlebar',styles:{background:'#234'},material:{asset:'paper',opacity:0.08}}]}});
      const text = mode === 'images' ? imageOutput : mode === 'invalid' || (mode === 'repair' && calls === 1) ? 'not JSON' : output;
      const delay = mode === 'slow';
      return new Response(new ReadableStream({async start(controller) {
        if (delay) await Bun.sleep(120);
        controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n'));
        controller.close();
      }}), {headers:{'Content-Type':'text/event-stream'}});
    }});
    migrate(getDb()); await ensureSettings();
    await updateSettings({prefs:{imageModel:{provider:'openai',model:'image-test'}},apiProviders:{kimi:{apiKey:'local-test',baseUrl:server.url+'v1'},openai:{apiKey:'local-test',baseUrl:server.url+'v1'}},modelOverrides:{'ui-generation':{provider:'kimi',model:'local-test'}}});
    ModelPolicy.recompute(loadSettings().modelOverrides);
    const id = await handleSkinCommand({action:'create',name:'Pipeline'});
    async function finish() {
      const until = Date.now()+4000;
      while (['generating','validating','assets','refining'].includes(getSkin(id).requests.at(-1)?.status) && Date.now()<until) await Bun.sleep(5);
      return getSkin(id);
    }
    try {
      await handleSkinCommand({action:'generate',id,prompt:'Generate green'});
      assert.equal((await finish()).versions.length,1); assert.equal(calls,3);
      mode='invalid';
      await handleSkinCommand({action:'generate',id,prompt:'Malformed response'});
      const failed=await finish(); assert.equal(failed.versions.length,1); assert.equal(failed.requests.at(-1).status,'failed');
      mode='slow';
      await handleSkinCommand({action:'generate',id,prompt:'Slow response'});
      await handleSkinCommand({action:'cancel',id});
      mode='valid';
      await handleSkinCommand({action:'generate',id,prompt:'Immediate retry'});
      const retried=await finish(); assert.equal(retried.versions.length,2);
      assert.equal(retried.requests.at(-2).status,'cancelled');
      await Bun.sleep(150); assert.equal(getSkin(id).versions.length,2);
      mode='images';
      await handleSkinCommand({action:'generate',id,prompt:'Add a generated material'});
      const illustrated=await finish(); assert.equal(illustrated.versions.length,3); assert.equal(imageCalls,1);
      assert.equal(illustrated.definition.assets.paper.id.length,32);
      const copy=await handleSkinCommand({action:'create',name:'Image copy',sourceId:id});
      assert.equal(getSkin(copy).definition.assets.paper.id,illustrated.definition.assets.paper.id);
      imageMode='empty-once'; art='Empty response retry'; const beforeRetry=imageCalls;
      await handleSkinCommand({action:'generate',id,prompt:'Retry empty image response'});
      assert.equal((await finish()).versions.length,4); assert.equal(imageCalls-beforeRetry,2);
      imageMode='error'; art='Failed new art';
      await handleSkinCommand({action:'generate',id,prompt:'Fail the image'});
      assert.equal((await finish()).versions.length,4); assert.equal(getSkin(id).requests.at(-1).error,'skins.error.images');
      imageMode='slow'; art='Fresh engraving';
      await handleSkinCommand({action:'generate',id,prompt:'Cancel during image generation'});
      while(getSkin(id).requests.at(-1).status !== 'assets') await Bun.sleep(5);
      let busy=false; try { await handleSkinCommand({action:'generate',id,prompt:'Overlap'}); } catch {busy=true;} assert(busy);
      await handleSkinCommand({action:'cancel',id});
      imageMode='ok';
      await handleSkinCommand({action:'generate',id,prompt:'Retry same art immediately'});
      const imageRetry=await finish(); assert.equal(imageRetry.versions.length,5); assert.equal(imageRetry.requests.at(-2).status,'cancelled');
      await handleSkinCommand({action:'activate',id,versionId:illustrated.versions[0].id});
      assert.equal(getSkin(id).definition.assets,undefined);
      await handleSkinCommand({action:'delete',id});
      assert.equal(getSkin(copy).definition.assets.paper.id,illustrated.definition.assets.paper.id);
      await handleSkinCommand({action:'delete',id:copy});
      imageMode='slow';
      const owner=new AbortController(), borrower=new AbortController();
      const firstImage=requestSkinImage('openai','image-test','Shared cancellation','1:1',owner.signal);
      void firstImage.catch(()=>{});
      const borrowedImage=requestSkinImage('openai','image-test','Shared cancellation','1:1',borrower.signal);
      await Bun.sleep(20); owner.abort();
      await assert.rejects(firstImage);
      assert.equal((await borrowedImage).length,32);
      console.log('skin pipeline passed');
    } finally {server.stop(true);}
  `,
    ],
    {
      cwd: new URL("../../../../../", import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        VIBEOS_AI_STUB: "0",
        VIBEOS_DB_PATH: `/tmp/vibeos-skin-pipeline-${process.pid}.db`,
        VIBEOS_DATA_DIR: `/tmp/vibeos-skin-pipeline-${process.pid}`,
      },
      timeout: 15000,
    },
  );
  expect(result.exitCode, result.stderr.toString() + result.stdout.toString()).toBe(0);
  expect(result.stdout.toString()).toContain("skin pipeline passed");
});

test("portable skins include image bytes, remap untrusted IDs, and import as independent editable copies", async () => {
  migrate(getDb());
  await ensureSettings();
  const id = await skins.createSkin("Portable paper");
  const imageId = "b".repeat(32);
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0mIAAAAASUVORK5CYII=",
    "base64",
  );
  await putImage({ id: imageId, bytes, mime: "image/png", prompt: "Paper", model: "test" });
  const d = skinDefinitionSchema.parse({
    ...definition("#234"),
    light: { "font-title": "Georgia, serif" },
    assets: { paper: { id: imageId, prompt: "Paper", aspect: "1:1" } },
    rules: [
      {
        target: "titlebar",
        styles: { background: "#234" },
        material: { asset: "paper", opacity: 0.06 },
      },
    ],
  });
  const request = await skins.startSkinRequest(id, "Portable texture");
  await skins.publishSkinVersion(request.id, d, "Paper", new AbortController().signal);
  const json = skins.exportSkin(id),
    data = JSON.parse(json);
  expect(data.images[imageId].data).toBe(bytes.toString("base64"));
  const imported = await skins.importSkin(json);
  const copy = skins.getSkin(imported);
  expect(copy.builtIn).toBe(false);
  expect(copy.foundation).toBeNull();
  expect(copy.versions).toHaveLength(0);
  const importedId = copy.definition.assets!.paper!.id!;
  expect(importedId).not.toBe(imageId);
  expect(getImage(importedId)!.bytes).toEqual(bytes);
  expect(compileSkin(imported, copy.definition)).toContain("opacity:0.06 !important");
  expect(compileSkin(imported, copy.definition)).toContain(".vibe-taskitem");
  await skins.deleteSkin(id);
  expect(getImage(importedId)!.bytes).toEqual(bytes);
  const active = loadSettings().skin;
  data.images = {};
  await expect(skins.importSkin(JSON.stringify(data))).rejects.toThrow("skins.error.package");
  data.images = {
    [imageId]: {
      mime: "image/png",
      data: Buffer.from("<script>alert(1)</script>").toString("base64"),
    },
  };
  await expect(skins.importSkin(JSON.stringify(data))).rejects.toThrow("skins.error.package");
  expect(loadSettings().skin).toBe(active);
  expect(getImage(imageId)!.bytes).toEqual(bytes);
  const builtin = await skins.importSkin(skins.exportSkin("xp"));
  expect(skins.getSkin(builtin).foundation).toBe("xp");
  expect(skins.getSkin(builtin).builtIn).toBe(false);
  expect(
    skinDefinitionSchema.safeParse({
      ...d,
      rules: [{ ...d.rules[0], material: { asset: "paper", opacity: 0.5 } }],
    }).success,
  ).toBe(false);
  await skins.deleteSkin(imported);
  await skins.deleteSkin(builtin);
});
