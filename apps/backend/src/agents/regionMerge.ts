import { extractRegions } from "../ai/streamParser.ts";

/**
 * Server-side region merge so the persisted snapshot stays in sync with what
 * the client renders. Uses string replacement keyed by data-vibeos-region,
 * mirroring the client's DOM-based applyRegions.
 */
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

export function applyRegionsServer(
  current: string,
  regions: { region: string; html: string }[],
): string {
  const ids = extractRegionIds(current);
  const seen = new Set<string>();
  const replacements = regions
    .map((r) => {
      const blocks = extractRegions(r.html.trim());
      const span = findRegionSpan(current, r.region);
      if (
        seen.has(r.region) ||
        ids.filter((id) => id === r.region).length !== 1 ||
        !span ||
        blocks.length !== 1 ||
        blocks[0]!.region !== r.region ||
        blocks[0]!.html !== r.html.trim()
      ) {
        throw new Error(`Invalid region replacement: ${r.region}`);
      }
      seen.add(r.region);
      return { ...span, html: r.html };
    })
    .sort((a, b) => b.start - a.start);
  let out = current;
  let boundary = current.length;
  for (const r of replacements) {
    if (r.end > boundary) throw new Error("Overlapping region replacements");
    out = out.slice(0, r.start) + r.html + out.slice(r.end);
    boundary = r.start;
  }
  const mergedIds = extractRegionIds(out);
  if (new Set(mergedIds).size !== mergedIds.length) throw new Error("Duplicate region ids");
  return out;
}

/** Locate the [start,end) of the element carrying data-vibeos-region=id, nesting-aware. */
function findRegionSpan(html: string, id: string): { start: number; end: number } | null {
  const openTag = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  const attrRe = new RegExp(`\\bdata-vibeos-region\\s*=\\s*["']${escapeRe(id)}["']`);
  let m: RegExpExecArray | null;
  while ((m = openTag.exec(html)) !== null) {
    const attrs = m[2] ?? "";
    if (!attrRe.test(attrs)) continue;
    const tag = m[1]!.toLowerCase();
    const start = m.index;
    if (attrs.trim().endsWith("/") || VOID_TAGS.has(tag)) {
      return { start, end: openTag.lastIndex };
    }
    const end = findElementEnd(html, openTag.lastIndex, tag);
    return end === -1 ? null : { start, end };
  }
  return null;
}

function findElementEnd(html: string, from: number, tag: string): number {
  const re = new RegExp(`<(/?)(${tag})\\b[^>]*?(/?)>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === "/") {
      if (--depth === 0) return re.lastIndex;
    } else if (m[3] !== "/") {
      depth++;
    }
  }
  return -1;
}

/** List the data-vibeos-region ids present in a snapshot. */
export function extractRegionIds(html: string): string[] {
  const ids: string[] = [];
  const re = /data-vibeos-region\s*=\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.push(m[1]!);
  return ids;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
