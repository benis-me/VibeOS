import { test, expect, describe } from "bun:test";
import { applyRegionsServer, extractRegionIds } from "./regionMerge.ts";

describe("applyRegionsServer", () => {
  test("replaces an existing region in place (nesting-aware)", () => {
    const current = `<div data-vibeos-region="body"><p>old</p></div>`;
    const next = `<div data-vibeos-region="body"><p>new</p></div>`;
    expect(applyRegionsServer(current, [{ region: "body", html: next }])).toBe(next);
  });

  test("preserves surrounding markup when replacing one region", () => {
    const current = `<header>top</header><div data-vibeos-region="body">old</div><footer>end</footer>`;
    const out = applyRegionsServer(current, [
      { region: "body", html: `<div data-vibeos-region="body">new</div>` },
    ]);
    expect(out).toBe(`<header>top</header><div data-vibeos-region="body">new</div><footer>end</footer>`);
  });

  test("appends a region that isn't present yet", () => {
    const out = applyRegionsServer(`<div data-vibeos-region="a">1</div>`, [
      { region: "b", html: `<div data-vibeos-region="b">2</div>` },
    ]);
    expect(out).toBe(`<div data-vibeos-region="a">1</div><div data-vibeos-region="b">2</div>`);
  });

  test("replacing a nested-content region doesn't stop at the first close tag", () => {
    const current = `<div data-vibeos-region="r"><ul><li>a</li></ul></div><span>after</span>`;
    const out = applyRegionsServer(current, [
      { region: "r", html: `<div data-vibeos-region="r"><ul><li>b</li></ul></div>` },
    ]);
    expect(out).toBe(`<div data-vibeos-region="r"><ul><li>b</li></ul></div><span>after</span>`);
  });
});

describe("extractRegionIds", () => {
  test("lists all region ids in document order", () => {
    const html = `<div data-vibeos-region="a"></div><p data-vibeos-region='b'></p>`;
    expect(extractRegionIds(html)).toEqual(["a", "b"]);
  });

  test("returns [] when there are no regions", () => {
    expect(extractRegionIds(`<div>plain</div>`)).toEqual([]);
  });
});
