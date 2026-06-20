import type { AppSearchResult } from "@vibeos/shared/protocol";
import { stripEmoji } from "@vibeos/shared/util";
import { run, recordSummary } from "./SdkManager.ts";
import { logger } from "../util/log.ts";

const log = logger("app-search");

// The icon vocabulary we can actually render (keys of the frontend AppIcon map).
// Constraining the model to this list means icons reliably resolve to a glyph
// instead of falling back to a monogram.
const ICON_VOCAB = [
  "globe",
  "terminal",
  "folder",
  "settings",
  "calculator",
  "music",
  "mail",
  "image",
  "calendar",
  "map",
  "gamepad-2",
  "notebook-pen",
  "cloud-sun",
  "palette",
  "paint-brush",
  "app-window",
  "file-text",
  "chat",
  "camera",
  "clock",
  "timer",
  "star",
  "heart",
  "user",
  "search",
  "bell",
  "video",
  "book-open",
  "shopping-cart",
  "code",
  "database",
  "chart-bar",
  "compass",
  "home",
  "wrench",
  "cloud",
  "sun",
  "moon",
  "trophy",
  "gift",
  "lightbulb",
  "fire",
  "leaf",
  "heartbeat",
  "barbell",
  "fork-knife",
  "coffee",
  "wallet",
  "credit-card",
  "briefcase",
  "car",
  "airplane",
  "rocket",
  "newspaper",
  "graduation-cap",
  "bug",
  "lightning",
].join(", ");

const SEARCH_INSTRUCTION = `You are the app search engine of VibeOS, an AI operating system where any app can be hallucinated into existence. Given a user's query, return a list of 4-8 plausible results that would satisfy it — a mix of obvious matches and a couple of imaginative ones. They don't need to exist; they will be generated on demand.

Reply with ONLY a fenced JSON code block, nothing else:
\`\`\`json
{ "results": [
  { "name": "App Name", "description": "one short line", "icon": "calculator", "kind": "app" }
] }
\`\`\`
Rules:
- name ≤ 30 chars; description ≤ 60 chars.
- kind: "widget" for a small, glanceable, single-purpose panel (clock, weather, stocks ticker, timer, mini player, to-do, system stat); "app" for a full interactive application (editor, browser, game, file tool, dashboard). Pick the more natural form for each result; include a sensible mix.
- icon: choose the SINGLE closest name from THIS list ONLY, nothing else: ${ICON_VOCAB}. Never invent a name, never use an emoji.
No prose outside the block.`;

const JSON_RE = /```(?:json)?\s*([\s\S]*?)```/i;

export async function searchApps(
  query: string,
  abort?: AbortController,
): Promise<AppSearchResult[]> {
  const t0 = performance.now();
  const result = await run({
    role: "system-event", // fast model — search should be snappy
    trigger: "user",
    systemPromptOverride: SEARCH_INSTRUCTION,
    prompt: `[QUERY]\n${query}`,
    appName: "App Search",
    abort, // a newer keystroke aborts this one — no wasted generation
  });
  // Superseded by a newer query: drop silently (the client already ignores it).
  if (abort?.signal.aborted) return [];
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
          kind: o.kind === "widget" ? "widget" : "app",
        };
      })
      .filter((r): r is AppSearchResult => r !== null)
      .slice(0, 8);
  } catch {
    log.warn("could not parse search results");
    return [];
  }
}
