import { describe, expect, it } from "vitest";
import { HealthResponse } from "./api.ts";
import { EMBED_PROTOCOL_VERSION, isHttpOrigin, parseWidgetToEmbed, widgetMessage } from "./embed-protocol.ts";
import { isValidSiteId } from "./site-id.ts";

describe("isValidSiteId", () => {
  it.each([
    ["abc", true],
    ["hisa-denk", true],
    ["a1-b2", true],
    ["a".repeat(63), true],
    ["ab", false], // 2 chars: one below minimum
    ["a".repeat(64), false], // one above maximum
    ["", false],
    ["-abc", false],
    ["abc-", false],
    ["Abc", false],
    ["ab_c", false],
    ["ab.c", false],
    ["hiša", false],
  ])("%j → %s", (value, expected) => {
    expect(isValidSiteId(value)).toBe(expected);
  });

  it("rejects non-strings", () => {
    expect(isValidSiteId(undefined)).toBe(false);
    expect(isValidSiteId(123)).toBe(false);
    expect(isValidSiteId(null)).toBe(false);
  });
});

describe("parseWidgetToEmbed", () => {
  it("accepts known messages", () => {
    expect(parseWidgetToEmbed({ v: 1, type: "widget:ready" })).toEqual({ v: 1, type: "widget:ready" });
    expect(parseWidgetToEmbed(widgetMessage("widget:close"))).toEqual({ v: 1, type: "widget:close" });
  });

  it.each([
    ["unknown type", { v: 1, type: "widget:open" }],
    ["wrong version", { v: 2, type: "widget:close" }],
    ["version as string", { v: "1", type: "widget:close" }],
    ["extra key", { v: 1, type: "widget:close", url: "https://evil.example" }],
    ["missing type", { v: 1 }],
    ["array", [1, "widget:close"]],
    ["string", "widget:close"],
    ["null", null],
  ])("rejects %s", (_name, data) => {
    expect(parseWidgetToEmbed(data)).toBeNull();
  });

  it("uses protocol version 1", () => {
    expect(EMBED_PROTOCOL_VERSION).toBe(1);
  });
});

describe("isHttpOrigin", () => {
  it.each([
    ["https://hisa-denk.si", true],
    ["http://localhost:5173", true],
    ["https://hisa-denk.si/", false], // trailing slash is not an origin
    ["https://hisa-denk.si/uredi", false],
    ["javascript:alert(1)", false],
    ["null", false],
    ["*", false],
    ["", false],
  ])("%j → %s", (value, expected) => {
    expect(isHttpOrigin(value)).toBe(expected);
  });
});

describe("HealthResponse", () => {
  it("accepts ok with version and rejects anything else", () => {
    expect(HealthResponse.safeParse({ status: "ok", version: "abc123" }).success).toBe(true);
    expect(HealthResponse.safeParse({ status: "ok", version: "" }).success).toBe(false);
    expect(HealthResponse.safeParse({ status: "down", version: "x" }).success).toBe(false);
    expect(HealthResponse.safeParse({ status: "ok", version: "x", extra: 1 }).success).toBe(false);
  });
});
