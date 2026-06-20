import { test, expect } from "bun:test";
import { parseClientMessage } from "./schema.ts";

test("accepts well-formed messages", () => {
  expect(
    parseClientMessage({ type: "c2s.app.search", payload: { query: "x", requestId: "1" } }),
  ).not.toBeNull();
  expect(
    parseClientMessage({ type: "c2s.command.run", payload: { text: "open calc", requestId: "1" } }),
  ).not.toBeNull();
  expect(parseClientMessage({ type: "c2s.provider.scan", payload: {} })).not.toBeNull();
  expect(
    parseClientMessage({
      type: "c2s.window.move",
      payload: { windowId: "w", x: 1, y: 2, w: 3, h: 4 },
    }),
  ).not.toBeNull();
});

test("rejects missing required fields", () => {
  expect(parseClientMessage({ type: "c2s.app.search", payload: { query: "x" } })).toBeNull();
  expect(parseClientMessage({ type: "c2s.window.move", payload: { windowId: "w" } })).toBeNull();
});

test("rejects wrong field types", () => {
  expect(
    parseClientMessage({
      type: "c2s.window.move",
      payload: { windowId: "w", x: "0", y: 0, w: 0, h: 0 },
    }),
  ).toBeNull();
  expect(parseClientMessage({ type: "c2s.app.launch", payload: { name: 42 } })).toBeNull();
});

test("rejects unknown message types and non-object payloads", () => {
  expect(parseClientMessage({ type: "c2s.bogus", payload: {} })).toBeNull();
  expect(parseClientMessage({ type: "c2s.app.search", payload: "hi" })).toBeNull();
  expect(parseClientMessage(null)).toBeNull();
  expect(parseClientMessage({})).toBeNull();
});

test("returns the parsed message for valid input", () => {
  const msg = parseClientMessage({
    type: "c2s.app.launch",
    payload: { name: "Clock", widget: true },
  });
  expect(msg?.type).toBe("c2s.app.launch");
});
