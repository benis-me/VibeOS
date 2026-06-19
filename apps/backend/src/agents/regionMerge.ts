/**
 * Server-side region merge so the persisted snapshot stays in sync with what
 * the client renders. Uses string replacement keyed by data-vibeos-region,
 * mirroring the client's DOM-based applyRegions.
 */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

export function applyRegionsServer(
  current: string,
  regions: { region: string; html: string }[],
): string {
  let out = current;
  for (const r of regions) {
    const span = findRegionSpan(out, r.region);
    if (span) {
      out = out.slice(0, span.start) + r.html + out.slice(span.end);
    } else {
      out += r.html; // region not present yet → append
    }
  }
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
