import { test, expect, describe } from "bun:test";
import { emojiFreeLine, stripEmoji } from "./emoji.ts";

describe("stripEmoji", () => {
  test("removes emoji with no surrounding spaces", () => {
    expect(stripEmoji("a🎉b")).toBe("ab");
  });

  test("keeps line breaks in user text", () => {
    expect(stripEmoji("first ✨\n\nsecond")).toBe("first \n\nsecond");
  });

  test("preserves CJK and other non-emoji unicode", () => {
    expect(stripEmoji("文件管理器")).toBe("文件管理器");
  });

  test("strips ZWJ sequence emoji (e.g. family)", () => {
    expect(stripEmoji("team 👨‍👩‍👧 here")).toBe("team  here");
  });
});

describe("emojiFreeLine", () => {
  test("removes an emoji and collapses the resulting double space", () => {
    expect(emojiFreeLine("Hello 👋 world")).toBe("Hello world");
  });

  test("strips a trailing pictograph and trims", () => {
    expect(emojiFreeLine("Files 📁")).toBe("Files");
  });

  test("leaves plain text untouched", () => {
    expect(emojiFreeLine("normal text")).toBe("normal text");
  });
});
