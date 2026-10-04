import { expect, test } from "bun:test";
import { APP_STATE_GUIDE, COMMUNICATION_GUIDE, assemblePrompt } from "./PromptAssembler.ts";
import { runtimeGuide } from "./runtimeGuide.ts";
import type { AppDescriptor } from "@vibeos/shared/domain";

const app = {
  id: "app-1",
  name: "Notes",
  kind: "virtual",
  isInstalled: true,
  icon: "notebook",
  manifest: { description: "Notes", runtime: "interactive" },
} as unknown as AppDescriptor;
const base = {
  app,
  memory: {
    windowId: "w",
    appId: "app-1",
    htmlSnapshot: "<main>old</main>",
    episodeSummary: "",
    updatedAt: 0,
  },
  recent: [],
  globalState: { now: "2026-10-05" },
  firstRender: false,
  renderMode: "prefer-incremental" as const,
  regionIds: ["list"],
};

test("fixed guides lead the prompt so providers can reuse the prefix", () => {
  const prompt = assemblePrompt({
    ...base,
    op: { kind: "click", action: "open", dataset: { id: "n1" } },
  });
  expect(
    prompt.startsWith(
      [runtimeGuide("interactive"), COMMUNICATION_GUIDE, APP_STATE_GUIDE].join("\n\n"),
    ),
  ).toBe(true);
  const order = ["[LOCAL VIEW STATE]", "[GLOBAL STATE]", "[APP]", "[CURRENT UI]"].map((s) =>
    prompt.indexOf(s),
  );
  expect(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]!))).toBe(true);
  // A guard against prompt bloat: the fixed text stays well below the snapshot it carries.
  expect(prompt.length).toBeLessThan(30_000);
});
