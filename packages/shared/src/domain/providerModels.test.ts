import { expect, test } from "bun:test";
import { providerModelList } from "./settings.ts";

const chat = (id: string) => ({ id, name: id, capabilities: ["text" as const] });
const image = (id: string) => ({ id, name: id, capabilities: ["image" as const] });
const ids = (list: { id: string }[]) => list.map((m) => m.id);

test("a fetched list replaces the catalog; custom models stay", () => {
  const catalog = [chat("old-1"), chat("shared"), image("imagegen")];
  expect(ids(providerModelList(catalog, undefined, [chat("mine")]))).toEqual([
    "old-1",
    "shared",
    "imagegen",
    "mine",
  ]);
  // Chat-only fetch (CodeBuddy's TUI list): catalog image models are kept.
  expect(ids(providerModelList(catalog, [chat("new"), chat("shared")], [chat("mine")]))).toEqual([
    "new",
    "shared",
    "imagegen",
    "mine",
  ]);
  // A fetch that lists image models replaces those too; an empty fetch falls back.
  expect(ids(providerModelList(catalog, [chat("new"), image("img-2")], []))).toEqual([
    "new",
    "img-2",
  ]);
  expect(ids(providerModelList(catalog, [], []))).toEqual(["old-1", "shared", "imagegen"]);
});
