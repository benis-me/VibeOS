import type { UiRegion } from "@vibeos/shared/protocol";

/** Validate the whole batch before touching the live DOM. Missing ids are never appended. */
export function replaceRegions(root: HTMLElement, regions: UiRegion[]): void {
  const seen = new Set<string>();
  const replacements = regions.map(({ region, html }) => {
    const targets = root.querySelectorAll(`[data-vibeos-region="${CSS.escape(region)}"]`);
    if (seen.has(region) || targets.length !== 1)
      throw new Error(`Invalid region target: ${region}`);
    seen.add(region);
    const target = targets[0]!;
    // Use the target's parent context so table rows/cells remain valid fragments.
    const range = target.ownerDocument.createRange();
    range.selectNode(target);
    const fragment = range.createContextualFragment(html);
    const replacement = fragment.firstElementChild;
    if (
      fragment.childElementCount !== 1 ||
      !replacement ||
      replacement.getAttribute("data-vibeos-region") !== region ||
      [...fragment.childNodes].some((n) => n !== replacement && n.textContent?.trim())
    ) {
      throw new Error(`Invalid region replacement: ${region}`);
    }
    return { target, replacement };
  });
  for (const a of replacements) {
    if (replacements.some((b) => a !== b && a.target.contains(b.target))) {
      throw new Error("Overlapping region replacements");
    }
  }
  const ids = [...root.querySelectorAll("[data-vibeos-region]")]
    .filter((el) => !replacements.some(({ target }) => target.contains(el)))
    .map((el) => el.getAttribute("data-vibeos-region"));
  for (const { replacement } of replacements) {
    ids.push(replacement.getAttribute("data-vibeos-region"));
    ids.push(
      ...[...replacement.querySelectorAll("[data-vibeos-region]")].map((el) =>
        el.getAttribute("data-vibeos-region"),
      ),
    );
  }
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate region ids");
  for (const { target, replacement } of replacements) {
    // Explicitly returned form regions may reset live values even when their HTML is unchanged.
    const hasFields =
      target.matches("input, textarea, select") || target.querySelector("input, textarea, select");
    if (hasFields || !target.isEqualNode(replacement)) target.replaceWith(replacement);
  }
}

/** Keep a complete snapshot for remount/reconnect; the surface applies the same patch locally. */
export function applyRegions(currentHtml: string, regions: UiRegion[]): string {
  // Keep unsanitized snapshots in an inert document; only sanitized HTML reaches the surface.
  const root = new DOMParser().parseFromString(currentHtml, "text/html").body;
  replaceRegions(root, regions);
  return root.innerHTML;
}
