import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppDescriptor } from "@vibeos/shared/domain";
import { parseClientMessage } from "@vibeos/shared/protocol";
import { migrate } from "../migrate.ts";
import { getDb } from "../database.ts";
import { ensureSettings, loadSettings, updateProfile, updateSettings } from "./SettingsRepo.ts";
import { assemblePrompt } from "../../prompt/PromptAssembler.ts";

test("profile migration preserves existing text once and never restores an emptied list", () => {
  const db = new Database(":memory:");
  try {
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && Number(f.split("_")[0]) <= 9)
      .sort()) {
      db.exec(readFileSync(new URL(file, dir), "utf8"));
    }
    db.exec(
      "CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (9)",
    );
    const original = "Use clear labels.\n保留这段原有内容。";
    db.query("INSERT INTO settings (id, user_profile, updated_at) VALUES (?, ?, 0)").run(
      "settings",
      original,
    );
    db.query("INSERT INTO settings (id, user_profile, updated_at) VALUES (?, ?, 0)").run(
      "empty",
      "   ",
    );
    migrate(db);
    const read = (id: string) =>
      JSON.parse(
        db
          .query<{ profile_entries_json: string }, [string]>(
            "SELECT profile_entries_json FROM settings WHERE id = ?",
          )
          .get(id)!.profile_entries_json,
      );
    expect(read("settings")).toEqual([{ id: "legacy-profile", content: original, enabled: true }]);
    expect(read("empty")).toEqual([]);
    db.exec("UPDATE settings SET profile_entries_json = '[]'");
    migrate(db);
    expect(read("settings")).toEqual([]);
  } finally {
    db.close();
  }
});

test("profile CRUD preserves concurrent edits and only enabled entries reach generation", async () => {
  migrate(getDb());
  await ensureSettings();
  await updateSettings({ profileEntries: [] });
  await Promise.all([
    updateProfile({ action: "save", content: "Prefer concise labels" }),
    updateProfile({ action: "save", content: "Use my private project context" }),
  ]);
  let entries = loadSettings().profileEntries;
  expect(entries).toHaveLength(2);
  const [first, second] = entries;
  // A toggle and an edit to the same entry must preserve both changes.
  await Promise.all([
    updateProfile({ action: "toggle", id: first!.id, enabled: false }),
    updateProfile({ action: "save", id: first!.id, content: "Updated preference" }),
    updateProfile({ action: "toggle", id: second!.id, enabled: false }),
  ]);
  entries = loadSettings().profileEntries;
  expect(entries.map((e) => e.enabled)).toEqual([false, false]);
  expect(entries[0]!.content).toBe("Updated preference");

  const app: AppDescriptor = {
    id: "test",
    name: "Test",
    kind: "virtual",
    icon: "app-window",
    manifest: {},
    isInstalled: false,
    createdAt: 0,
    updatedAt: 0,
  };
  const prompt = () =>
    assemblePrompt({
      app,
      memory: null,
      recent: [],
      globalState: {},
      firstRender: true,
      renderMode: "force-full",
      profileEntries: loadSettings().profileEntries,
    });
  expect(prompt()).not.toContain("[USER PROFILE]");
  await updateProfile({ action: "toggle", id: first!.id, enabled: true });
  expect(prompt()).toContain("Updated preference");
  expect(prompt()).not.toContain("private project context");
  // All enabled content must survive the former 800-character truncation.
  await updateProfile({
    action: "save",
    content: `${"Detailed preference. ".repeat(50)}END_OF_PREFERENCE`,
  });
  expect(prompt()).toContain("END_OF_PREFERENCE");
  await updateProfile({ action: "disable-all" });
  expect(prompt()).not.toContain("[USER PROFILE]");
  expect(prompt()).not.toContain("END_OF_PREFERENCE");

  const reloaded = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { loadSettings } from './apps/backend/src/db/repositories/SettingsRepo.ts';
    console.log(JSON.stringify(loadSettings().profileEntries));
  `,
    ],
    {
      cwd: fileURLToPath(new URL("../../../../../", import.meta.url)),
      env: { ...process.env, NODE_OPTIONS: "" },
    },
  );
  expect(reloaded.exitCode).toBe(0);
  expect(JSON.parse(reloaded.stdout.toString())).toEqual(loadSettings().profileEntries);
  await updateProfile({ action: "remove", id: first!.id });
  expect(loadSettings().profileEntries.some((e) => e.id === first!.id)).toBe(false);
  await expect(
    updateProfile({ action: "save", id: first!.id, content: "stale edit" }),
  ).rejects.toThrow();
  await expect(updateProfile({ action: "save", content: "  " })).rejects.toThrow();
  expect(loadSettings().profileEntries).toHaveLength(2);
  await Promise.all(
    loadSettings().profileEntries.map((e) => updateProfile({ action: "remove", id: e.id })),
  );
  expect(loadSettings().profileEntries).toEqual([]);
  expect(prompt()).not.toContain("[USER PROFILE]");
});

test("profile messages validate content and booleans and reject whole-list replacements", () => {
  const parse = (payload: unknown) => parseClientMessage({ type: "c2s.profile.update", payload });
  expect(parse({ action: "save", content: "  My preference  " })?.payload).toEqual({
    action: "save",
    content: "My preference",
  });
  for (const payload of [
    { action: "save", content: "\n " },
    { action: "save", content: 42 },
    { action: "toggle", id: "id", enabled: "false" },
    { action: "remove", id: "" },
    { action: "unknown" },
  ])
    expect(parse(payload)).toBeNull();
  expect(parse({ action: "disable-all" })).not.toBeNull();
  expect(
    parseClientMessage({
      type: "c2s.settings.update",
      payload: { partial: { profileEntries: [] } },
    }),
  ).toBeNull();
});
