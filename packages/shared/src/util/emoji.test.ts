import { test, expect, describe } from "bun:test";
import { stripEmoji } from "./emoji.ts";

describe("stripEmoji", () => {
  test("removes an emoji and collapses the resulting double space", () => {
    expect(stripEmoji("Hello 👋 world")).toBe("Hello world");
  });

  test("strips a trailing pictograph and trims", () => {
    expect(stripEmoji("Files 📁")).toBe("Files");
  });

  test("removes emoji with no surrounding spaces", () => {
    expect(stripEmoji("a🎉b")).toBe("ab");
  });

  test("leaves plain text untouched", () => {
    expect(stripEmoji("normal text")).toBe("normal text");
  });

  test("preserves CJK and other non-emoji unicode", () => {
    expect(stripEmoji("文件管理器")).toBe("文件管理器");
  });

  test("strips ZWJ sequence emoji (e.g. family)", () => {
    expect(stripEmoji("team 👨‍👩‍👧 here")).toBe("team here");
  });
});
