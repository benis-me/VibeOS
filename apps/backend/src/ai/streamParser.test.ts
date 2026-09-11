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
  test("explicit mode distinguishes a full root region from a region patch", () => {
    const body = '<main data-vibeos-region="root">new page</main>';
    expect(parseAiOutput(`<vibeos-html mode="full">${body}</vibeos-html>`).html).toBe(body);
    expect(parseAiOutput(`<vibeos-html mode="regions">${body}</vibeos-html>`).regions).toEqual([
      { region: "root", html: body },
    ]);
    expect(parseAiOutput(`<vibeos-html>${body}</vibeos-html>`, "full").html).toBe(body);
    expect(extractStreamingHtml('<vibeos-html mode="full"><main>')).toBe("<main>");
  });

  test("incomplete or invalid declared patches cannot become a full page", () => {
    for (const output of [
      '<vibeos-html mode="regions"><div>not a region</div></vibeos-html>',
      '<vibeos-html mode="regions"><div data-vibeos-region="a">unfinished',
      '<vibeos-html mode="unknown"><div>invalid mode</div></vibeos-html>',
    ]) {
      const result = parseAiOutput(output);
      expect(result.renderError).toBeDefined();
      expect(result.html).toBeUndefined();
      expect(result.regions).toBeUndefined();
    }
  });

  test("Notes-style commented patches keep exact region bytes without requiring another model call", () => {
    const sidebar =
      '<aside data-vibeos-region="notes-sidebar" title="1 > 0"><!-- <aside> -->Selected</aside>';
    const editor =
      '<section data-vibeos-region="notes-editor"><textarea><!-- <section data-vibeos-region="example">literal</section> --></textarea></section>';
    const output = `<vibeos-html mode="regions"><!-- 左侧边栏 -->${sidebar}\n<!-- 右侧编辑器 -->${editor}<!-- end --></vibeos-html>`;
    expect(parseAiOutput(output)).toMatchObject({
      regions: [
        { region: "notes-sidebar", html: sidebar },
        { region: "notes-editor", html: editor },
      ],
    });
    expect(parseAiOutput(output).renderError).toBeUndefined();
    expect(extractRegions("<!-- " + sidebar + " -->" + sidebar)).toEqual([
      { region: "notes-sidebar", html: sidebar },
    ]);
    expect(
      parseAiOutput(
        '<vibeos-html mode="regions"><!-- <div data-vibeos-region="fake">ignored</div> --></vibeos-html>',
      ).renderError,
    ).toBeDefined();
    for (const suffix of [
      "<!-- unfinished",
      "unexpected text",
      "<div>untargeted content</div>",
      '<section data-vibeos-region="broken">',
    ]) {
      const parsed = parseAiOutput(`<vibeos-html mode="regions">${sidebar}${suffix}</vibeos-html>`);
      expect(parsed.renderError).toBeDefined();
      expect(parsed.regions).toBeUndefined();
    }
  });

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

  test("complete region replacements tolerate orphan closing wrappers without a model repair", () => {
    const status = '<div data-vibeos-region="status">Done</div>';
    const actions = '<section data-vibeos-region="actions"><button>Undo</button></section>';
    const parsed = parseAiOutput(`<vibeos-html mode="regions">${status}</div>\n${actions}</vibeos-html>`);
    expect(parsed.renderError).toBeUndefined();
    expect(parsed.regions).toEqual([{ region: "status", html: status }, { region: "actions", html: actions }]);
    expect(parseAiOutput(`<vibeos-html mode="regions">${status}<div>missing region</div>${actions}</vibeos-html>`).renderError).toBeDefined();
  });

  test("malformed syscall entries reject the entire batch before UI or actions commit", () => {
    const out = parseAiOutput(
      `<vibeos-html><div>z</div></vibeos-html>
\`\`\`vibeos-syscall
{ "calls": [ { "type": "notify", "title": "" }, { "type": "notify", "title": "ok" } ] }
\`\`\``,
    );
    expect(out.syscalls).toHaveLength(0);
    expect(out.syscallError).toBeDefined();
    for (const block of ["{broken", "{}", '{"calls": {}}']) {
      const parsed = parseAiOutput("```vibeos-syscall\n" + block + "\n```");
      expect(parsed.syscallError).toBeDefined();
      expect(parsed.syscalls).toEqual([]);
    }
    expect(parseAiOutput('```vibeos-syscall\n{"calls":[]}').syscallError).toBeDefined();
  });

  test("only top-level syscall blocks execute; HTML, summaries and code examples are literal", () => {
    const call = (title: string) =>
      "```vibeos-syscall\n" + JSON.stringify({ calls: [{ type: "notify", title }] }) + "\n```";
    const body = `<main><textarea>literal </vibeos-html>\n${call("textarea")}</textarea><pre>${call("pre")}</pre><!-- ${call("comment")} --></main>`;
    const output = `<vibeos-html mode="full">${body}</vibeos-html><vibeos-summary>${call("summary")}</vibeos-summary>\n${call("real")}`;
    const parsed = parseAiOutput(output);
    expect(parsed.html).toBe(body);
    expect(parsed.syscalls).toEqual([{ type: "notify", title: "real" }]);
    expect(parsed.syscallError).toBeUndefined();
    expect(extractStreamingHtml(output)).toBe(body);
    expect(parseAiOutput(`<vibeos-html><textarea>${call("unfinished")}`).syscalls).toEqual([]);
    expect(parseAiOutput("````text\n" + call("example") + "\n````").syscalls).toEqual([]);
    const literal = "<vibeos-html>file contents</vibeos-html>";
    expect(
      parseAiOutput(
        "```vibeos-syscall\n" +
          JSON.stringify({
            calls: [{ type: "create-file", name: "sample.txt", content: literal }],
          }) +
          "\n```",
      ).syscalls[0],
    ).toMatchObject({ content: literal });
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
