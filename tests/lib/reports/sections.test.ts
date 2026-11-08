import { describe, expect, it } from "vitest";
import { SECTION_IDS, VIEW_COOKIE, VIEW_COOKIE_MAX_BYTES, parseHiddenSections, serializeHiddenSections } from "@/lib/reports/sections";

describe("SC1 the section allowlist", () => {
  it("is exactly five ids, in page order, and the cards are not among them", () => {
    expect([...SECTION_IDS]).toEqual(["money", "owed", "quality", "complaints", "bank"]);
    expect(VIEW_COOKIE).toBe("committee_view");
  });
});

describe("SC2 the committee_view cookie parser", () => {
  it("reads the hidden ids the app writes", () => {
    expect(parseHiddenSections("owed")).toEqual(["owed"]);
    expect(parseHiddenSections("money,complaints,bank")).toEqual(["money", "complaints", "bank"]);
    expect(parseHiddenSections(SECTION_IDS.join(","))).toEqual([...SECTION_IDS]);
  });

  it("says none hidden for no cookie and for an empty one", () => {
    expect(parseHiddenSections(undefined)).toEqual([]);
    expect(parseHiddenSections(null)).toEqual([]);
    expect(parseHiddenSections("")).toEqual([]);
  });

  it.each([
    ["an unknown id", "money,secrets"],
    ["only an unknown id", "cards"],
    ["a repeated id", "money,money"],
    ["an empty id between commas", "money,,bank"],
    ["a trailing comma", "money,"],
    ["capital letters", "Money"],
    ["spaces", "money, bank"],
    ["a script tag", "<script>alert(1)</script>"],
    ["a quote and an attribute", 'money" onload="x'],
    ["a path traversal", "../../etc/passwd"],
    ["a newline", "money\nbank"],
    ["a semicolon", "money;bank"],
    ["a percent escape", "mon%65y"],
    ["a unicode look-alike", "mοney"],
  ])("ignores the whole cookie for %s", (_name, value) => {
    expect(parseHiddenSections(value)).toEqual([]);
  });

  it("ignores a value over 80 bytes, a 10 KB value, and counts bytes not letters", () => {
    expect(new TextEncoder().encode(SECTION_IDS.join(",")).length).toBeLessThanOrEqual(VIEW_COOKIE_MAX_BYTES);
    expect(parseHiddenSections(`money${",money".repeat(20)}`)).toEqual([]);
    expect(parseHiddenSections("money,".repeat(2000))).toEqual([]);
    expect(parseHiddenSections("x".repeat(10_240))).toEqual([]);
    expect(parseHiddenSections("é".repeat(41))).toEqual([]);
  });
});

describe("SC3 the cookie value written", () => {
  it("is the hidden ids in page order, whatever order they were chosen in, and parses back", () => {
    expect(serializeHiddenSections(["bank", "money"])).toBe("money,bank");
    expect(parseHiddenSections(serializeHiddenSections(["complaints", "owed"]))).toEqual(["owed", "complaints"]);
    expect(serializeHiddenSections([])).toBe("");
  });

  it("is never more than 80 bytes", () => {
    expect(new TextEncoder().encode(serializeHiddenSections([...SECTION_IDS])).length).toBeLessThanOrEqual(VIEW_COOKIE_MAX_BYTES);
  });
});
