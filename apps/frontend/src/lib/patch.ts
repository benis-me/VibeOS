import type { UiRegion } from "@vibeos/shared/protocol";

/**
 * Apply region replacements to an HTML snapshot. Each region targets an element
 * carrying data-vibeos-region="<id>" and replaces its outerHTML.
 * Returns the merged HTML string.
 */
export function applyRegions(currentHtml: string, regions: UiRegion[]): string {
  if (regions.length === 0) return currentHtml;
  const doc = new DOMParser().parseFromString(
    `<div id="__root">${currentHtml}</div>`,
    "text/html",
  );
  const root = doc.getElementById("__root");
  if (!root) return currentHtml;

  for (const r of regions) {
    const target = root.querySelector(`[data-vibeos-region="${cssEscape(r.region)}"]`);
    if (target) {
      target.outerHTML = r.html;
    } else {
      // Region not found — append as a fallback so content isn't lost.
      root.insertAdjacentHTML("beforeend", r.html);
    }
  }
  return root.innerHTML;
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
