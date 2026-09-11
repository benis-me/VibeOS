import { syscallSchema, type ParsedAiOutput } from "@vibeos/shared/prompt";

/** Read protocol blocks at the response's top level, never from displayed content. */
function outputBlocks(full: string) {
  const blocks: { kind: string; body: string; attrs: string; complete: boolean }[] = [];
  const token =
    /<!--[\s\S]*?(?:-->|$)|<vibeos-(html|summary)\b((?:"[^"]*"|'[^']*'|[^'">])*)>|(`{3,})([^\r\n`]*)\r?\n/gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(full))) {
    if (match[0].startsWith("<!--")) continue;
    const from = token.lastIndex;
    if (match[1]) {
      const kind = match[1].toLowerCase();
      let depth = 1;
      const end = htmlTags(full.slice(from)).find((tag) => {
        if (tag.tag !== `vibeos-${kind}`) return false;
        if (tag.close) depth--;
        else if (!tag.single) depth++;
        return depth === 0;
      });
      blocks.push({
        kind,
        attrs: match[2] ?? "",
        body: full.slice(from, end ? from + end.start : full.length),
        complete: !!end,
      });
      token.lastIndex = end ? from + end.end : full.length;
    } else {
      const close = new RegExp(
        "(?:^|\\n)[ \\t]*`{" + match[3]!.length + ",}[ \\t]*(?=\\r?\\n|$|<vibeos-)",
        "g",
      );
      close.lastIndex = from;
      const end = close.exec(full);
      if (match[4]!.trim().toLowerCase() === "vibeos-syscall")
        blocks.push({
          kind: "syscall",
          attrs: "",
          body: full.slice(from, end?.index ?? full.length),
          complete: !!end,
        });
      token.lastIndex = end ? close.lastIndex : full.length;
    }
  }
  return blocks;
}

/** Incrementally extract the streaming HTML body for live patching. */
export function extractStreamingHtml(buffer: string): string | null {
  return outputBlocks(buffer).find((block) => block.kind === "html")?.body ?? null;
}

/** Parse the complete AI output into its structured parts. */
export function parseAiOutput(full: string, legacyMode?: "full"): ParsedAiOutput {
  const blocks = outputBlocks(full);
  const summary = blocks.find((block) => block.kind === "summary")?.body.trim() ?? "";
  const result: ParsedAiOutput = {
    ...parseSyscalls(blocks.filter((b) => b.kind === "syscall")),
    summary,
  };
  const htmlBlocks = blocks.filter((block) => block.kind === "html");
  const open = htmlBlocks[0];
  if (open) {
    const declaredMode = /\bmode\s*=\s*["']([^"']*)["']/i.exec(open.attrs)?.[1];
    if (
      !open.complete ||
      htmlBlocks.length !== 1 ||
      (declaredMode !== undefined && declaredMode !== "full" && declaredMode !== "regions")
    ) {
      result.renderError = "Incomplete HTML envelope or invalid render mode";
      return result;
    }
    const html = open.body.trim();
    const spans = extractRegionSpans(html);
    const regions = spans.map(({ region, start, end }) => ({
      region,
      html: html.slice(start, end),
    }));
    const onlyRegions = regions.length > 0 && isOnlyRegions(html, spans);
    const mode = declaredMode ?? legacyMode;
    if (!html || (mode === "regions" && !onlyRegions)) {
      result.renderError = "Expected complete region blocks with stable ids";
    } else if (mode !== "full" && onlyRegions) {
      result.regions = regions;
    } else {
      result.html = html.trim();
    }
  }
  return result;
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

/** Token boundaries only; preserve original bytes instead of repairing/serializing model HTML. */
function htmlTags(html: string) {
  const re =
    /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  const tags: {
    tag: string;
    close: boolean;
    single: boolean;
    region?: string;
    start: number;
    end: number;
  }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (!match[2]) continue; // Comments, including tag-like text inside them, are not elements.
    const tag = match[2].toLowerCase(),
      attrs = match[3] ?? "",
      close = match[1] === "/";
    const attributes = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let region: string | undefined, attr: RegExpExecArray | null;
    while ((attr = attributes.exec(attrs))) {
      if (attr[1]!.toLowerCase() === "data-vibeos-region") {
        region = attr[2] ?? attr[3] ?? attr[4];
        break;
      }
    }
    tags.push({
      tag,
      close,
      single: VOID_TAGS.has(tag) || attrs.trim().endsWith("/"),
      region,
      start: match.index,
      end: re.lastIndex,
    });
    if (!close && RAW_TEXT_TAGS.has(tag)) {
      const end = new RegExp(`</${tag}\\s*>`, "gi");
      end.lastIndex = re.lastIndex;
      re.lastIndex = end.exec(html)?.index ?? html.length;
    }
  }
  return tags;
}

/**
 * Depth-aware extraction of every element carrying data-vibeos-region, including
 * its full (possibly nested) inner HTML. A regex like /…<\/tag>/ would stop at
 * the first closing tag and shred nested content — so we scan tag-by-tag and
 * balance open/close tags to find the true end of each region element.
 */
export function extractRegions(html: string): { region: string; html: string }[] {
  return extractRegionSpans(html).map(({ region, start, end }) => ({
    region,
    html: html.slice(start, end),
  }));
}

/** Shared by output validation and disk-snapshot merging, so they agree on actual target elements. */
export function extractRegionSpans(
  html: string,
  includeNested = false,
): { region: string; start: number; end: number }[] {
  const tags = htmlTags(html),
    spans: { region: string; start: number; end: number }[] = [];
  for (let i = 0; i < tags.length; i++) {
    const open = tags[i]!;
    if (open.close || !open.region) continue;
    let endIndex = open.single ? i : -1;
    if (!open.single) {
      let depth = 1;
      for (let j = i + 1; j < tags.length; j++) {
        const tag = tags[j]!;
        if (tag.tag !== open.tag) continue;
        if (tag.close) depth--;
        else if (!tag.single) depth++;
        if (depth === 0) {
          endIndex = j;
          break;
        }
      }
    }
    if (endIndex < 0) continue;
    spans.push({ region: open.region, start: open.start, end: tags[endIndex]!.end });
    if (!includeNested) i = endIndex;
  }
  return spans;
}

function isOnlyRegions(html: string, regions: { start: number; end: number }[]): boolean {
  // Replacements are complete, independent elements. Stray closing tags between
  // them cannot close anything inside a replacement; discard this wrapper noise.
  const trivia = (text: string) =>
    !text.replace(/<!--[\s\S]*?-->|<\/[a-z][a-z0-9:-]*\s*>/gi, "").trim();
  let end = 0;
  for (const region of regions) {
    if (!trivia(html.slice(end, region.start))) return false;
    end = region.end;
  }
  return trivia(html.slice(end));
}

function parseSyscalls(
  blocks: { body: string; complete: boolean }[],
): Pick<ParsedAiOutput, "syscalls" | "syscallError"> {
  const calls: unknown[] = [];
  for (const block of blocks) {
    if (!block.complete) return { syscalls: [], syscallError: "Incomplete syscall block" };
    try {
      const json = JSON.parse(block.body);
      const batch = Array.isArray(json) ? json : json?.calls;
      if (!Array.isArray(batch)) throw new Error();
      calls.push(...batch);
    } catch {
      return { syscalls: [], syscallError: "Expected syscall JSON with a calls array" };
    }
  }
  const parsed = syscallSchema.array().max(8).safeParse(calls);
  return parsed.success
    ? { syscalls: parsed.data }
    : {
        syscalls: [],
        syscallError: `Invalid syscall at ${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`,
      };
}
