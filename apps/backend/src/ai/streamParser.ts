import { syscallSchema, type ParsedAiOutput } from "@vibeos/shared/prompt";

const HTML_OPEN = "<vibeos-html>";
const HTML_CLOSE = "</vibeos-html>";
const SUMMARY_RE = /<vibeos-summary>([\s\S]*?)<\/vibeos-summary>/i;
const SYSCALL_RE = /```vibeos-syscall\s*([\s\S]*?)```/i;

/** Incrementally extract the streaming HTML body for live patching. */
export function extractStreamingHtml(buffer: string): string | null {
  const start = buffer.indexOf(HTML_OPEN);
  if (start === -1) return null;
  const from = start + HTML_OPEN.length;
  const end = buffer.indexOf(HTML_CLOSE, from);
  return end === -1 ? buffer.slice(from) : buffer.slice(from, end);
}

/** Parse the complete AI output into its structured parts. */
export function parseAiOutput(full: string): ParsedAiOutput {
  const html = extractFullHtml(full);
  const summary = SUMMARY_RE.exec(full)?.[1]?.trim() ?? "";
  const syscalls = parseSyscalls(full);

  const result: ParsedAiOutput = { syscalls, summary };

  if (html !== null) {
    const regions = extractRegions(html);
    // If the body is *only* region blocks (no other meaningful content), treat
    // as a patch; otherwise treat as a full replacement.
    if (regions.length > 0 && isOnlyRegions(html, regions)) {
      result.regions = regions;
    } else {
      result.html = html.trim();
    }
  }
  return result;
}

function extractFullHtml(full: string): string | null {
  const start = full.indexOf(HTML_OPEN);
  if (start === -1) return null;
  const from = start + HTML_OPEN.length;
  const end = full.indexOf(HTML_CLOSE, from);
  return end === -1 ? full.slice(from).trim() : full.slice(from, end).trim();
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
const OPEN_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
const REGION_ATTR = /\bdata-vibeos-region\s*=\s*["']([^"']+)["']/;

/**
 * Depth-aware extraction of every element carrying data-vibeos-region, including
 * its full (possibly nested) inner HTML. A regex like /…<\/tag>/ would stop at
 * the first closing tag and shred nested content — so we scan tag-by-tag and
 * balance open/close tags to find the true end of each region element.
 */
export function extractRegions(html: string): { region: string; html: string }[] {
  const out: { region: string; html: string }[] = [];
  OPEN_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN_TAG.exec(html)) !== null) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2] ?? "";
    const regionMatch = REGION_ATTR.exec(attrs);
    if (!regionMatch) continue;
    const regionId = regionMatch[1]!;
    const startIdx = m.index;

    // Self-closing or void → the element is just the open tag.
    if (attrs.trim().endsWith("/") || VOID_TAGS.has(tag)) {
      out.push({ region: regionId, html: html.slice(startIdx, OPEN_TAG.lastIndex) });
      continue;
    }

    const endIdx = findElementEnd(html, OPEN_TAG.lastIndex, tag);
    if (endIdx === -1) continue;
    out.push({ region: regionId, html: html.slice(startIdx, endIdx) });
    OPEN_TAG.lastIndex = endIdx; // skip past this element to avoid nested re-capture
  }
  return out;
}

/** Find the index just past the matching close tag for `tag`, starting at `from`. */
function findElementEnd(html: string, from: number, tag: string): number {
  const re = new RegExp(`<(/?)(${tag})\\b[^>]*?(/?)>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const isClose = m[1] === "/";
    const selfClose = m[3] === "/";
    if (isClose) {
      depth--;
      if (depth === 0) return re.lastIndex;
    } else if (!selfClose) {
      depth++;
    }
  }
  return -1;
}

function isOnlyRegions(html: string, regions: { html: string }[]): boolean {
  let rest = html;
  for (const r of regions) rest = rest.replace(r.html, "");
  return rest.trim().length === 0;
}

function parseSyscalls(full: string): ParsedAiOutput["syscalls"] {
  const block = SYSCALL_RE.exec(full)?.[1]?.trim();
  if (!block) return [];
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch {
    console.warn("[syscall] unparseable block dropped");
    return [];
  }

  // Be tolerant: validate each call individually so one malformed entry doesn't
  // discard the rest. Accept either { calls: [...] } or a bare array.
  const raw = Array.isArray(json)
    ? json
    : Array.isArray((json as { calls?: unknown })?.calls)
      ? (json as { calls: unknown[] }).calls
      : [];

  const out: ParsedAiOutput["syscalls"] = [];
  for (const item of raw) {
    const parsed = syscallSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else
      console.warn(
        "[syscall] dropped invalid call:",
        parsed.error.issues[0]?.message,
        JSON.stringify(item).slice(0, 120),
      );
  }
  return out;
}
