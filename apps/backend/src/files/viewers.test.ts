import { expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileMediaType, NATIVE_PRESET_APPS } from "@vibeos/shared/domain";
import { parseClientMessage } from "@vibeos/shared/protocol";
import { diskPath, executeDisk } from "./disk.ts";
import { migrate } from "../db/migrate.ts";
import { getDb } from "../db/database.ts";
import { seedPresets } from "../db/repositories/AppRepo.ts";
import { getWindow, listOpenWindows } from "../db/repositories/WindowRepo.ts";
import { mutateDisk } from "../db/repositories/VfsRepo.ts";
import { openDiskFile, serveDiskFile } from "../server/filesHandlers.ts";

test("native viewers dispatch real files, retain paths and follow moves without accepting links", async () => {
  migrate(getDb());
  await seedPresets();
  const root = `viewers-${randomUUID()}`;
  mkdirSync(diskPath(root));
  try {
    const text = `${root}/说明.html`;
    writeFileSync(diskPath(text), "<script>literal text only</script>");
    writeFileSync(diskPath(`${root}/photo.PNG`), "image");
    writeFileSync(diskPath(`${root}/sound.mp3`), "audio");
    writeFileSync(diskPath(`${root}/clip.webm`), "video");
    symlinkSync(diskPath(text), diskPath(`${root}/link.txt`));
    const window = await openDiskFile(text);
    expect(window.appId).toBe("text-viewer");
    expect(listOpenWindows().find((w) => w.id === window.id)?.filePath).toBe(text);
    for (const name of ["photo.PNG", "sound.mp3", "clip.webm"]) {
      expect((await openDiskFile(`${root}/${name}`)).appId).toBe("media-viewer");
    }
    for (const path of [root, `${root}/link.txt`, "../runtime/vibeos.db", `${root}/missing.txt`]) {
      await expect(openDiskFile(path)).rejects.toThrow();
    }
    await mutateDisk({ action: "move", path: text, destination: `${root}/renamed.html` });
    expect(getWindow(window.id)?.title).toBe("renamed.html");
    expect(getWindow(window.id)?.filePath).toBe(`${root}/renamed.html`);
    const trashed = await mutateDisk({ action: "trash", path: `${root}/renamed.html` });
    expect(getWindow(window.id)?.filePath).toBe(`Trash/${trashed.result.path}/item`);
    await mutateDisk({ action: "restore", path: trashed.result.path! });
    expect(getWindow(window.id)?.filePath).toBe(`${root}/renamed.html`);
    expect(executeDisk({ action: "read", path: `${root}/renamed.html` }).content).toContain(
      "<script>",
    );
    expect(NATIVE_PRESET_APPS).toContain("text-viewer");
    expect(NATIVE_PRESET_APPS).toContain("media-viewer");
    expect(
      parseClientMessage({
        v: 1,
        type: "c2s.files.request",
        payload: { requestId: "open", command: { action: "open", path: text } },
      }),
    ).not.toBeNull();
    for (const path of ["file.html", "file.svg", "file.constructor", "mp3"])
      expect(fileMediaType(path)).toBeUndefined();
  } finally {
    rmSync(diskPath(root), { recursive: true });
  }
});

test("media streams support seeking; active content, unsafe paths and origins cannot preview", async () => {
  const root = `media-${randomUUID()}`;
  mkdirSync(diskPath(root));
  writeFileSync(diskPath(`${root}/clip.mp4`), "0123456789");
  writeFileSync(diskPath(`${root}/page.html`), "<h1>literal</h1>");
  const server = Bun.serve({ port: 0, fetch: serveDiskFile });
  const url = (path: string, action = "preview") =>
    `http://localhost:${server.port}/api/files/${action}?path=${encodeURIComponent(path)}`;
  try {
    const partial = await fetch(url(`${root}/clip.mp4`), { headers: { Range: "bytes=2-4" } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-type")).toBe("video/mp4");
    expect(partial.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await partial.text()).toBe("234");
    const tail = await fetch(url(`${root}/clip.mp4`), { headers: { Range: "bytes=-2" } });
    expect(await tail.text()).toBe("89");
    expect((await fetch(url(`${root}/page.html`))).status).toBe(415);
    expect((await fetch(url("../runtime/vibeos.db"))).ok).toBe(false);
    expect(
      (await fetch(url(`${root}/clip.mp4`), { headers: { Origin: "https://example.com" } })).status,
    ).toBe(403);
    const download = await fetch(url(`${root}/page.html`, "download"));
    expect(download.headers.get("content-disposition")).toStartWith("attachment;");
    expect(await download.text()).toBe("<h1>literal</h1>");
  } finally {
    server.stop(true);
    rmSync(diskPath(root), { recursive: true });
  }
});
