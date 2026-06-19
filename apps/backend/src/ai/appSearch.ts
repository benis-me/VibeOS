import type { AppSearchResult } from "@vibeos/shared/protocol";
import { stripEmoji } from "@vibeos/shared/util";
import { run, recordSummary } from "./SdkManager.ts";
import { logger } from "../util/log.ts";

const log = logger("app-search");

const SEARCH_INSTRUCTION = `You are the app search engine of VibeOS, an AI operating system where any app can be hallucinated into existence. Given a user's query, return a list of 4-8 plausible apps that would satisfy it — a mix of obvious matches and a couple of imaginative ones. These apps don't need to exist; they will be generated on demand.

Reply with ONLY a fenced JSON code block, nothing else:
\`\`\`json
{ "results": [
  { "name": "App Name", "description": "one short line", "icon": "calculator" }
] }
\`\`\`
Rules: name ≤ 30 chars; description ≤ 60 chars. icon = a lucide-react icon name in kebab-case (e.g. "calculator", "music", "mail", "image", "calendar", "map", "gamepad-2"), NEVER an emoji. No prose outside the block.`;

const JSON_RE = /```(?:json)?\s*([\s\S]*?)```/i;

export async function searchApps(query: string): Promise<AppSearchResult[]> {
  const t0 = performance.now();
  const result = await run({
    role: "system-event", // fast model — search should be snappy
    trigger: "user",
    systemPromptOverride: SEARCH_INSTRUCTION,
    prompt: `[QUERY]\n${query}`,
    appName: "App Search",
  });
  const parsed = parse(result.text);
  await recordSummary(result.runId, `"${query}" → ${parsed.length} results`);
  log.info(`"${query}" → ${parsed.length} results in ${(performance.now() - t0).toFixed(0)}ms`);
  return parsed;
}

function parse(text: string): AppSearchResult[] {
  const block = JSON_RE.exec(text)?.[1] ?? text;
  try {
    const json = JSON.parse(block) as { results?: unknown };
    const arr = Array.isArray(json.results) ? json.results : [];
    return arr
      .map((r) => {
        const o = r as Record<string, unknown>;
        if (typeof o.name !== "string") return null;
        const name = stripEmoji(o.name).slice(0, 40);
        if (!name) return null;
        const rawIcon = typeof o.icon === "string" ? stripEmoji(o.icon).trim() : "";
        return {
          name,
          description:
            typeof o.description === "string" ? stripEmoji(o.description).slice(0, 80) : "",
          // lucide icon name; default to a generic app icon
          icon: rawIcon || "app-window",
        };
      })
      .filter((r): r is AppSearchResult => r !== null)
      .slice(0, 8);
  } catch {
    log.warn("could not parse search results");
    return [];
  }
}
