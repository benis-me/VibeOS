import { test, expect, describe } from "bun:test";
import { parseAiOutput, extractStreamingHtml, extractRegions } from "./streamParser.ts";

describe("extractStreamingHtml", () => {
  test("returns null before the open tag arrives", () => {
    expect(extractStreamingHtml("thinking…")).toBeNull();
  });

  test("returns the partial body while still streaming (no close tag)", () => {
    expect(extractStreamingHtml("<vibeos-html><div>hi")).toBe("<div>hi");
  });

  test("returns the body once closed", () => {
    expect(extractStreamingHtml("<vibeos-html><div>hi</div></vibeos-html>tail")).toBe(
      "<div>hi</div>",
    );
  });
});

describe("parseAiOutput", () => {
  test("full body → html mode, with summary + syscalls", () => {
    const out = parseAiOutput(
      `<vibeos-html><div style="padding:8px"><h1>Hi</h1></div></vibeos-html>
\`\`\`vibeos-syscall
{ "calls": [ { "type": "notify", "title": "Hello", "kind": "info" } ] }
\`\`\`
<vibeos-summary>Said hi.</vibeos-summary>`,
    );
    expect(out.html).toContain("<h1>Hi</h1>");
    expect(out.regions).toBeUndefined();
    expect(out.summary).toBe("Said hi.");
    expect(out.syscalls).toHaveLength(1);
    expect(out.syscalls[0]).toMatchObject({ type: "notify", title: "Hello" });
  });

  test("body of only region blocks → regions mode (not full)", () => {
    const out = parseAiOutput(
      `<vibeos-html><div data-vibeos-region="root"><p>x</p></div></vibeos-html>`,
    );
    expect(out.html).toBeUndefined();
    expect(out.regions).toEqual([
      { region: "root", html: `<div data-vibeos-region="root"><p>x</p></div>` },
    ]);
  });

  test("region block plus other content → full replace, not a patch", () => {
    const out = parseAiOutput(
      `<vibeos-html><header>bar</header><div data-vibeos-region="body">x</div></vibeos-html>`,
    );
    expect(out.regions).toBeUndefined();
    expect(out.html).toContain("<header>bar</header>");
  });

  test("malformed syscall entries are dropped, valid ones kept", () => {
    const out = parseAiOutput(
      `<vibeos-html><div>z</div></vibeos-html>
\`\`\`vibeos-syscall
{ "calls": [ { "type": "notify", "title": "" }, { "type": "notify", "title": "ok" } ] }
\`\`\``,
    );
    expect(out.syscalls).toHaveLength(1);
    expect(out.syscalls[0]).toMatchObject({ title: "ok" });
  });

  test("no html → html and regions both undefined", () => {
    const out = parseAiOutput(`<vibeos-summary>nothing rendered</vibeos-summary>`);
    expect(out.html).toBeUndefined();
    expect(out.regions).toBeUndefined();
    expect(out.summary).toBe("nothing rendered");
  });
});

describe("extractRegions (depth-aware)", () => {
  test("captures the full nested inner HTML of a region, not just to the first close", () => {
    const html = `<div data-vibeos-region="r"><ul><li>a</li><li>b</li></ul></div>`;
    expect(extractRegions(html)).toEqual([{ region: "r", html }]);
  });

  test("does not re-capture a region nested inside another region", () => {
    const html = `<section data-vibeos-region="outer"><div data-vibeos-region="inner">x</div></section>`;
    const regions = extractRegions(html);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.region).toBe("outer");
  });

  test("two sibling regions are both captured", () => {
    const html = `<div data-vibeos-region="a">1</div><div data-vibeos-region="b">2</div>`;
    expect(extractRegions(html).map((r) => r.region)).toEqual(["a", "b"]);
  });
});
