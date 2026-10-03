import { extractRegionSpans } from "../ai/streamParser.ts";

/**
 * The only region merge: string replacement keyed by data-vibeos-region. The
 * client stores the merged snapshot and replaces the named regions' live nodes.
 */
export function applyRegionsServer(
  current: string,
  regions: { region: string; html: string }[],
): string {
  const spans = extractRegionSpans(current, true);
  const ids = spans.map((r) => r.region);
  const seen = new Set<string>();
  const replacements = regions
    .map((r) => {
      const html = r.html.trim();
      const blocks = extractRegionSpans(html);
      const [block] = blocks;
      const span = spans.find((s) => s.region === r.region);
      if (
        seen.has(r.region) ||
        ids.filter((id) => id === r.region).length !== 1 ||
        !span ||
        blocks.length !== 1 ||
        !block ||
        block.region !== r.region ||
        block.start !== 0 ||
        block.end !== html.length ||
        (block.append && (span.innerEnd === undefined || block.innerEnd === undefined))
      ) {
        throw new Error(`Invalid region replacement: ${r.region}`);
      }
      seen.add(r.region);
      // Appended children follow the existing content; the target keeps its own tag.
      return {
        ...span,
        html: block.append
          ? current.slice(span.start, span.innerEnd) +
            html.slice(block.innerStart, block.innerEnd) +
            current.slice(span.innerEnd, span.end)
          : r.html,
      };
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

/** List the data-vibeos-region ids present in a snapshot. */
export function extractRegionIds(html: string): string[] {
  return extractRegionSpans(html, true).map((r) => r.region);
}
