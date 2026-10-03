import { expect, test } from "bun:test";
import { parseAiOutput } from "../ai/streamParser.ts";
import { OutputRejected, validateOutput } from "./outputRules.ts";

// Cases mirror the rejections recorded in real runs (agent_logs ui/syscall.rejected).
const snapshot =
  '<main data-vibeos-region="page"><ul data-vibeos-region="list"><li data-vibeos-region="task-1">Write</li></ul><p data-vibeos-region="count">0 done</p></main>';
const summary = "<vibeos-summary>Task 1 is done.</vibeos-summary>\n";
const calls = (list: unknown[] = [{ type: "app-state" }]) =>
  `\`\`\`vibeos-syscall\n${JSON.stringify({ calls: list })}\n\`\`\`\n`;
const regions = (body: string) => `<vibeos-html mode="regions">${body}</vibeos-html>`;
const count = '<p data-vibeos-region="count">1 done</p>';
const base = { snapshot, fullRequired: false, readOnlyRefresh: false, runtime: "html" as const };

const accepted: [string, string, Partial<typeof base>, string | undefined][] = [
  [
    "a record patch merges into the snapshot",
    summary + calls() + regions(`<li data-vibeos-region="task-1">Write (done)</li>${count}`),
    {},
    'Write (done)</li></ul><p data-vibeos-region="count">1 done',
  ],
  [
    "an unknown notify kind is normalized instead of rejected",
    summary +
      calls([{ type: "app-state" }, { type: "notify", title: "Saved", kind: "notice" }]) +
      regions(count),
    {},
    "1 done",
  ],
  ["a read-only refresh may confirm with a summary", summary, { readOnlyRefresh: true }, undefined],
];

const rejected: [string, string, Partial<typeof base>, RegExp, boolean][] = [
  [
    "missing app-state keeps the render mode",
    summary + regions(count),
    {},
    /exactly one app-state/,
    false,
  ],
  ["a summary alone is retried in the same mode", summary, {}, /no UI or system action/, false],
  [
    "a read-only refresh must not write data",
    summary + calls([{ type: "app-state", data: { done: 1 } }]) + regions(count),
    { readOnlyRefresh: true },
    /only refreshes the view/,
    false,
  ],
  [
    "a script in a classic version keeps the render mode",
    summary +
      calls() +
      '<vibeos-html mode="full"><main><script type="application/vibeos" data-vibeos-script="a">1</script></main></vibeos-html>',
    {},
    /runtime\.error\.script/,
    false,
  ],
  [
    "stray content between regions needs the full body",
    summary + calls() + regions(`${count} and more`),
    {},
    /complete region blocks/,
    true,
  ],
  [
    "an unknown region target needs the full body",
    summary + calls() + regions('<header data-vibeos-region="head">x</header>'),
    {},
    /Invalid region replacement: head/,
    true,
  ],
  [
    "an incomplete envelope needs the full body",
    `${summary}${calls()}<vibeos-html mode="full"><main>cut off`,
    {},
    /Incomplete HTML envelope/,
    true,
  ],
  [
    "a region patch is refused when the full body is required",
    summary + calls() + regions(count),
    { fullRequired: true },
    /complete window body is required/,
    true,
  ],
];

for (const [name, output, context, html] of accepted)
  test(name, async () => {
    const parsed = parseAiOutput(output);
    const result = await validateOutput(parsed, { ...base, ...context });
    if (html === undefined) expect(result.html).toBeUndefined();
    else expect(result.html).toContain(html);
    for (const call of parsed.syscalls) if (call.type === "notify") expect(call.kind).toBe("info");
  });

for (const [name, output, context, reason, full] of rejected)
  test(name, async () => {
    const parsed = parseAiOutput(output, context.fullRequired ? "full" : undefined);
    const error = await validateOutput(parsed, { ...base, ...context }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(String(error instanceof Error && error.message)).toMatch(reason);
    expect(error instanceof OutputRejected && error.full).toBe(full);
  });
