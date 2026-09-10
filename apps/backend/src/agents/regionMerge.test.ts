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
    expect(out).toBe(
      `<header>top</header><div data-vibeos-region="body">new</div><footer>end</footer>`,
    );
  });

  test("validation and merging agree on real elements, not comments, attribute text or textarea content", () => {
    const comment = '<!-- <section data-vibeos-region="body">example</section> -->';
    const body =
      '<section title=\'data-vibeos-region="fake" >\' data-vibeos-region="body"><textarea><section data-vibeos-region="body">literal</section></textarea>Original</section>';
    const current = comment + body + '<footer data-vibeos-region="footer">Keep</footer>';
    expect(extractRegionIds(current)).toEqual(["body", "footer"]);
    const next = '<section data-vibeos-region="body">Updated</section>';
    expect(applyRegionsServer(current, [{ region: "body", html: next }])).toBe(
      comment + next + '<footer data-vibeos-region="footer">Keep</footer>',
    );
    expect(() =>
      applyRegionsServer(current, [
        { region: "fake", html: '<section data-vibeos-region="fake">Wrong</section>' },
      ]),
    ).toThrow();
  });

  test("rejects missing targets instead of appending unrelated content", () => {
    expect(() =>
      applyRegionsServer(`<div data-vibeos-region="a">1</div>`, [
        { region: "b", html: `<div data-vibeos-region="b">2</div>` },
      ]),
    ).toThrow();
  });

  test("rejects duplicate, overlapping, or malformed replacements as one batch", () => {
    const current =
      '<main data-vibeos-region="outer"><div data-vibeos-region="inner">old</div></main>';
    const inner = { region: "inner", html: '<div data-vibeos-region="inner">new</div>' };
    for (const patches of [
      [inner, inner],
      [inner, { region: "outer", html: current }],
      [{ region: "inner", html: '<div data-vibeos-region="other">wrong target</div>' }],
      [{ region: "inner", html: '<div data-vibeos-region="inner">incomplete' }],
      [
        {
          region: "inner",
          html: '<div data-vibeos-region="inner"><b data-vibeos-region="outer">duplicate</b></div>',
        },
      ],
    ])
      expect(() => applyRegionsServer(current, patches)).toThrow();
    expect(() => applyRegionsServer(current + current, [inner])).toThrow();
  });

  test("updates sibling regions together while retaining the surrounding page", () => {
    const current =
      '<main><header>keep</header><div data-vibeos-region="a">1</div><div data-vibeos-region="b">2</div></main>';
    expect(
      applyRegionsServer(current, [
        { region: "a", html: '<div data-vibeos-region="a">3</div>' },
        { region: "b", html: '<div data-vibeos-region="b">4</div>' },
      ]),
    ).toBe(current.replace(">1<", ">3<").replace(">2<", ">4<"));
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
