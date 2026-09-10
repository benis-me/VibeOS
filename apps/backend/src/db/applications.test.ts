import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("local app lifecycle preserves identities, versions, data, portable assets and memory deletion boundaries", () => {
  const directory = mkdtempSync(join(tmpdir(), "vibeos-applications-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
      import {strict as assert} from "node:assert";
      import {readFileSync,writeFileSync,rmSync} from "node:fs";
      import {getDb} from "./apps/backend/src/db/database.ts";
      import {migrate} from "./apps/backend/src/db/migrate.ts";
      import {ensureSettings} from "./apps/backend/src/db/repositories/SettingsRepo.ts";
      import {ensureDiskLayout,writeAppPackage,writeContent} from "./apps/backend/src/files/content.ts";
      import {diskPath,executeDisk} from "./apps/backend/src/files/disk.ts";
      import {installApp,getApp,listApps,seedPresets} from "./apps/backend/src/db/repositories/AppRepo.ts";
      import * as A from "./apps/backend/src/db/repositories/ApplicationRepo.ts";
      import * as M from "./apps/backend/src/db/repositories/SystemMemoryRepo.ts";
      import {openWindow,getWindow} from "./apps/backend/src/db/repositories/WindowRepo.ts";
      import {ensureMemory,saveSnapshot,getSnapshot} from "./apps/backend/src/db/repositories/AppMemoryRepo.ts";
      import {mutateDisk,ensureShortcut,getNode,moveNode,syncDesktopFiles,listByLocation} from "./apps/backend/src/db/repositories/VfsRepo.ts";
      import {exportApplication,importApplication,importApplicationDirectory} from "./apps/backend/src/db/repositories/ApplicationPackageRepo.ts";
      import {putImage} from "./apps/backend/src/db/repositories/ImagesRepo.ts";
      import {handleApplicationCommand} from "./apps/backend/src/ai/applications.ts";
      import {applicationDefinitionSchema} from "@vibeos/shared";
      const db=getDb();migrate(db);ensureDiskLayout();await ensureSettings();
      // Recreate a v2 application and window, then migrate twice.
      const app=await installApp({name:"Old Notes",manifest:{description:"Notes",seedHtml:"<main>Original private note</main>"}});
      const win=await openWindow({appId:app.id,title:app.name});await ensureMemory(win.id,app.id);
      const old="Applications/Old Notes";writeAppPackage(app,old+"/app.json");
      writeContent(old+"/Windows/"+win.id+"/index.html","<main>Untouched old window</main>");
      db.query("UPDATE apps SET content_path=?,active_version_id=NULL WHERE id=?").run(old+"/app.json",app.id);
      db.query("DELETE FROM app_versions WHERE app_id=?").run(app.id);
      db.query("UPDATE app_memory SET snapshot_path=? WHERE window_id=?").run(old+"/Windows/"+win.id+"/index.html",win.id);
      const shortcut=await ensureShortcut(app.id,app.name,app.icon);
      db.query("INSERT INTO storage_version VALUES (2,NULL,1)").run();
      // Remove only the newly created unused v3 bundle to mimic an actual old disk.
      rmSync(diskPath("Applications/"+executeDisk({action:"list",path:"Applications"}).entries.find(e=>e.name.endsWith(".vibeapp")).name),{recursive:true});
      await A.migrateApplications();await A.migrateApplications();
      assert.equal(getSnapshot(win.id),"<main>Untouched old window</main>");
      assert.equal(getWindow(win.id).appId,app.id);assert.equal(getNode(shortcut.id).targetAppId,app.id);
      assert.equal(executeDisk({action:"stat",path:A.applicationPath(app.id)}).entry.kind,"application");
      const originalVersion=A.applicationState().applications[0].activeVersionId;
      let data=A.getAppData(app.id);data=await A.setAppData(app.id,{version:data.version,data:{notes:["keep me"],world:{door:"open"}}});
      await assert.rejects(A.setAppData(app.id,{version:"0".repeat(64),data:{}}),/dataConflict/);
      const copy=await A.duplicateApplication(app.id,"Independent Notes");assert.deepEqual(A.getAppData(copy.id).data,{});
      assert.equal(A.readApplicationVersion(copy.id).seedHtml,"");
      const image="a";await putImage({id:image,prompt:"test",model:"test",mime:"image/png",bytes:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==","base64")});
      const definition=applicationDefinitionSchema.parse({description:"A reusable app",instructions:"Keep notes in app-data",seedHtml:'<main data-vibeos-region="root"><img src="/api/img/a"><span>a word stays unchanged</span></main>',assets:{cover:image}});
      const request=await A.startApplicationRequest(app.id,"Add a cover");
      await A.publishApplicationVersion(request.id,definition,"Cover added",undefined,new AbortController().signal);
      const latest=A.applicationState().applications.find(a=>a.appId===app.id).activeVersionId;
      assert.notEqual(latest,originalVersion);assert.equal(getWindow(win.id).appVersionId,originalVersion);
      assert.deepEqual(A.getAppData(app.id).data,data.data);
      const exported=JSON.parse(exportApplication(app.id));assert(!("data" in exported));
      assert(!JSON.stringify(exported).includes("keep me"));
      const imported=await importApplication(JSON.stringify(exported));
      assert.notEqual(imported.id,app.id);assert.deepEqual(A.getAppData(imported.id).data,{});
      assert(A.readApplicationVersion(imported.id).seedHtml.includes("a word stays unchanged"));
      assert.notEqual(A.readApplicationVersion(imported.id).assets.cover,"a");
      const withData=await importApplication(exportApplication(app.id,true));assert.deepEqual(A.getAppData(withData.id).data,data.data);
      const directoryCopy=await importApplicationDirectory(A.applicationPath(app.id));assert.notEqual(directoryCopy.id,app.id);
      await seedPresets();
      const {executeFileCommand}=await import("./apps/backend/src/server/filesHandlers.ts");
      const revealed=await executeFileCommand({action:"reveal",path:A.applicationPath(app.id)});
      assert.equal(getWindow(revealed.windowId).appId,"file-manager");
      const count=listApps().length;
      await assert.rejects(importApplication(JSON.stringify({...exported,definition:{...definition,seedHtml:'<img onerror="alert(1)">'}})));
      assert.equal(listApps().length,count);
      const imagePath=db.query("SELECT content_path FROM images WHERE id=?").get(image).content_path;
      rmSync(diskPath(imagePath));assert(JSON.parse(exportApplication(app.id)).images.a);
      await A.activateApplicationVersion(app.id,originalVersion);assert.deepEqual(A.getAppData(app.id).data,data.data);
      await A.activateApplicationVersion(app.id,latest);
      const path=A.applicationPath(app.id);const trash=await mutateDisk({action:"trash",path});assert.equal(getApp(app.id),null);assert.equal(getNode(shortcut.id).location,"recyclebin");
      await mutateDisk({action:"restore",path:trash.result.path});assert.equal(getApp(app.id).isInstalled,true);assert.equal(getNode(shortcut.id).location,"desktop");
      await mutateDisk({action:"move",path,destination:"Documents/Moved.vibeapp"});assert(A.readApplicationVersion(app.id).seedHtml.includes("a word"));assert.equal(getApp(app.id).id,app.id);
      assert.deepEqual(A.getAppData(app.id).data,data.data);
      await mutateDisk({action:"move",path:"Documents/Moved.vibeapp",destination:"Desktop/Moved.vibeapp"});
      await syncDesktopFiles();const bundleNode=listByLocation("desktop").find(n=>n.meta.diskPath==="Desktop/Moved.vibeapp");
      await moveNode({nodeId:bundleNode.id,location:"recyclebin"});assert.equal(getApp(app.id),null);assert.equal(getNode(shortcut.id).location,"recyclebin");
      await moveNode({nodeId:bundleNode.id,location:"desktop"});assert(getApp(app.id).isInstalled);assert.equal(getNode(shortcut.id).location,"desktop");
      await A.renameApplication(app.id,"Renamed Notes");assert.equal(getApp(app.id).name,"Renamed Notes");assert(A.readApplicationVersion(app.id).seedHtml.includes("a word"));
      const created=await handleApplicationCommand({action:"create",name:"Background",prompt:"A compact imaginary library"});
      for(let i=0;i<100;i++){if(A.applicationState().applications.find(a=>a.appId===created.appId).requests[0]?.status==="succeeded")break;await Bun.sleep(10);}
      assert.equal(A.applicationState().applications.find(a=>a.appId===created.appId).requests[0].status,"succeeded");
      assert.equal(M.systemMemoryState().enabled,false);assert.equal(M.systemMemoryContext(),"");
      await M.changeSystemMemory({action:"toggle",enabled:true});const revision=M.systemMemoryState().revision;
      assert(await M.rememberExtracted({save:[{content:"The user prefers concise Chinese."}],remove:[]},revision,"Command"));
      assert(M.systemMemoryContext().includes("concise Chinese"));
      const stale=M.systemMemoryState().revision;
      await M.changeSystemMemory({action:"clear"});
      assert.equal(await M.rememberExtracted({save:[{content:"Must not reappear"}],remove:[]},stale,"Command"),false);
      await M.changeSystemMemory({action:"save",content:"Keep this entry"});
      await M.changeSystemMemory({action:"toggle",enabled:false});assert.equal(M.systemMemoryContext(),"");assert.equal(M.systemMemoryState().entries.length,1);
      assert.equal(await M.rememberExtracted({save:[{content:"Do not save"}],remove:[]},M.systemMemoryState().revision,"Command"),false);
      console.log("lifecycle and memory assertions passed");
    `,
      ],
      {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          VIBEOS_DATA_DIR: directory,
          VIBEOS_DB_PATH: join(directory, "runtime/vibeos.db"),
          VIBEOS_AI_STUB: "1",
          VIBEOS_AGENTS_DISABLED: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (result.exitCode !== 0)
      throw new Error(
        new TextDecoder().decode(result.stderr) + new TextDecoder().decode(result.stdout),
      );
    expect(result.exitCode).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AI read/write continuations retain complete original fields and system memory reaches model calls", () => {
  const directory = mkdtempSync(join(tmpdir(), "vibeos-continuations-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
      import {strict as assert} from "node:assert";
      import {getDb} from "./apps/backend/src/db/database.ts";
      import {migrate} from "./apps/backend/src/db/migrate.ts";
      import {ensureSettings} from "./apps/backend/src/db/repositories/SettingsRepo.ts";
      import {ensureDiskLayout} from "./apps/backend/src/files/content.ts";
      import {installApp} from "./apps/backend/src/db/repositories/AppRepo.ts";
      import {getAppData} from "./apps/backend/src/db/repositories/ApplicationRepo.ts";
      import {openWindow} from "./apps/backend/src/db/repositories/WindowRepo.ts";
      import {ensureMemory,saveSnapshot} from "./apps/backend/src/db/repositories/AppMemoryRepo.ts";
      import {getProvider,setActiveProvider} from "./apps/backend/src/ai/providers/index.ts";
      import {changeSystemMemory,systemMemoryState} from "./apps/backend/src/db/repositories/SystemMemoryRepo.ts";
      import {registerCommunication} from "./apps/backend/src/events/communication.ts";
      import {registerUiGenerationAgent} from "./apps/backend/src/agents/UiGenerationAgent.ts";
      import {bus} from "./apps/backend/src/events/bus.ts";
      migrate(getDb());ensureDiskLayout();await ensureSettings();
      await changeSystemMemory({action:"toggle",enabled:true});await changeSystemMemory({action:"save",content:"Concise Chinese answers."});
      const app=await installApp({name:"Continuation"});const win=await openWindow({appId:app.id,title:app.name});
      await ensureMemory(win.id,app.id);await saveSnapshot(win.id,'<main data-vibeos-region="root">Ready</main>');
      await registerCommunication();registerUiGenerationAgent();setActiveProvider("codex");
      const provider=await getProvider("codex");let step=0;let error;let memorySeen=false;
      const body="The full submitted body must survive. "+"x".repeat(400)+" EXACT_END";
      const syscall=command=>'\x60\x60\x60vibeos-syscall\\n'+JSON.stringify({calls:[{type:"communication",command}]})+'\\n\x60\x60\x60';
      provider.run=async(options)=>{
        try {
          if(options.prompt.startsWith("[VIBEOS_MEMORY_EXTRACTION]")) {
            assert(!options.systemPrompt.includes("[SAVED USER MEMORIES]"));
            return {ok:true,text:JSON.stringify({save:[{content:"A new preference."}],remove:[]})};
          }
          assert(options.systemPrompt.includes("Concise Chinese answers."));memorySeen=true;
          step++;
          if(step===1)return {ok:true,text:syscall({action:"request",target:{system:"app-data"},topic:"get",responseMode:"ai"})};
          assert(options.prompt.includes("[WORKFLOW INPUT]"));assert(options.prompt.includes(body));
          if(step===2)return {ok:true,text:syscall({action:"request",target:{system:"app-data"},topic:"set",data:{version:getAppData(app.id).version,data:{body}},responseMode:"ai"})};
          return {ok:true,text:'<vibeos-html mode="full"><main data-vibeos-region="root">Saved</main></vibeos-html>'};
        } catch(e) {error=e;return {ok:false,text:"",error:"fixture assertion"};}
      };
      bus.emit("op.received",{windowId:win.id,op:{kind:"submit",action:"save",formData:{title:"Input",body}}});
      for(let i=0;i<200;i++){if(step>=3)break;await Bun.sleep(10);}
      if(error)throw error;assert.equal(step,3);assert(memorySeen);assert.equal(getAppData(app.id).data.body,body);
      for(let i=0;i<100;i++){if(systemMemoryState().entries.length===2)break;await Bun.sleep(10);}
      assert.equal(systemMemoryState().entries.length,2);
    `,
      ],
      {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          VIBEOS_DATA_DIR: directory,
          VIBEOS_DB_PATH: join(directory, "runtime/vibeos.db"),
          VIBEOS_AI_STUB: "0",
          VIBEOS_AGENTS_DISABLED: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (result.exitCode !== 0)
      throw new Error(
        new TextDecoder().decode(result.stderr) + new TextDecoder().decode(result.stdout),
      );
    expect(result.exitCode).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
