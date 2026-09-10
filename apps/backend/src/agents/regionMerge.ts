import { extractRegions, extractRegionSpans } from "../ai/streamParser.ts";

/**
 * Server-side region merge so the persisted snapshot stays in sync with what
 * the client renders. Uses string replacement keyed by data-vibeos-region,
 * mirroring the client's DOM-based applyRegions.
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
      const blocks = extractRegions(r.html.trim());
      const span = spans.find((s) => s.region === r.region);
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

/** List the data-vibeos-region ids present in a snapshot. */
export function extractRegionIds(html: string): string[] {
  return extractRegionSpans(html, true).map((r) => r.region);
}
