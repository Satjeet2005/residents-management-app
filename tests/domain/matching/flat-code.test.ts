import { describe, expect, it } from "vitest";
import { extractFlatTokens, isValidFlatCode, normalizeFlatCodeParts } from "@/domain/matching/flat-code";

const codes = (text: string) => extractFlatTokens(text).map((t) => t.code);

describe("P2 flat codes: the canonical form", () => {
  it.each(["T01-0101", "T12-0408", "T28-1608", "T07-1203", "T21-1601", "T03-0702"])("accepts %s", (code) => {
    expect(isValidFlatCode(code)).toBe(true);
  });

  it.each(["T00-0101", "T29-0101", "T12-0001", "T12-1708", "T12-0409", "T12-0400", "t12-0408", "T12-408", "T1-0408", "T12 0408", "T12-04080", "", " T12-0408"])("rejects %j", (code) => {
    expect(isValidFlatCode(code)).toBe(false);
  });

  it("builds a code from parts and pads a 3-digit number", () => {
    expect(normalizeFlatCodeParts("12", "408")).toBe("T12-0408");
    expect(normalizeFlatCodeParts(7, 1203)).toBe("T07-1203");
    expect(normalizeFlatCodeParts("3", "702")).toBe("T03-0702");
    expect(normalizeFlatCodeParts("29", "0408")).toBeNull();
    expect(normalizeFlatCodeParts("12", "40")).toBeNull();
    expect(normalizeFlatCodeParts("123", "0408")).toBeNull();
  });
});

describe("P2 flat codes: variants that must resolve to T12-0408", () => {
  it.each(["T12-0408", "t12 0408", "T12/408", "T12_408", "T12.0408", "T120408", "T12408", "FLAT T12 408", "T-12-0408"])("reads %j", (text) => {
    expect(extractFlatTokens(text)).toEqual([{ code: "T12-0408", ambiguous: false, matchedText: expect.stringMatching(/^[Tt]/) }]);
  });

  it.each([
    ["NEFT-N30112345-SHARMA R-T12 408", "T12-0408"],
    ["maint T03 702", "T03-0702"],
    ["T15-0902 3 months", "T15-0902"],
    ["T21-1601 ADV", "T21-1601"],
    ["UPI/402200118877/x/(T07-1203)", "T07-1203"],
    ["t7 1203", "T07-1203"],
    ["flat:T18_1105.", "T18-1105"],
  ])("reads %j inside other text", (text, code) => {
    expect(codes(text)).toEqual([code]);
  });

  it("reports the text it read", () => {
    expect(extractFlatTokens("FLAT T12 408 maint")[0].matchedText).toBe("T12 408");
  });

  it("returns each distinct code once, in order", () => {
    expect(codes("T12-0408 and T07-1203 and again t12/408")).toEqual(["T12-0408", "T07-1203"]);
  });
});

describe("P2 flat codes: ambiguity", () => {
  it("returns both readings when the text fits two valid codes", () => {
    const tokens = extractFlatTokens("T1 1101");
    expect(tokens.map((t) => [t.code, t.ambiguous])).toEqual([["T01-1101", true], ["T11-0101", true]]);
    expect(tokens.every((t) => t.matchedText === "T1 1101")).toBe(true);
  });

  it("the joined 3-digit form can be ambiguous too", () => {
    expect(extractFlatTokens("T11101").map((t) => [t.code, t.ambiguous])).toEqual([["T01-1101", true], ["T11-0101", true]]);
  });

  it("returns the one valid reading as certain, even when a separator would suggest another", () => {
    expect(extractFlatTokens("T1 2408").map((t) => [t.code, t.ambiguous])).toEqual([["T12-0408", false]]);
  });
});

/** Text that must never give a flat code. */
const NOT_FLAT_CODES: string[] = [
  "9876543210", // a 10-digit phone number
  "5000000006",
  "+91 98765 43210",
  "402200118877", // a 12-digit UPI reference
  "UPI/402200118877/aamir.s@oksbi/maintenance",
  "N30112345", // a UTR
  "HDFCR52026102712345",
  "NEFT-N30112346-GUPTA AND SONS",
  "12-04-2026", // dates
  "12/04/26",
  "05-Oct-2026",
  "2026-10-05",
  "INT.PD 01-07-2026 TO 30-09-2026",
  "6370", // amounts
  "1,06,468",
  "10,646.80",
  "Rs 6370 only",
  "CHQ DEP 004512", // cheque numbers
  "CHEQUE 004513",
  "CHQ RET 004512 INSUFFICIENT FUNDS",
  "T29-0408", // tower out of range
  "T00-0408",
  "T12-1708", // floor out of range
  "T12-0008",
  "T12-0409", // unit out of range
  "T12-0400",
  "T120409",
  "T9876543210", // a phone number with a T in front
  "UPIT12-0408", // T inside a word
  "MAINT12 0408",
  "NEFT 12 0408", // no T
  "12-0408",
  "T 2026",
  "T12",
  "T12-04",
  "T12-04081", // too many digits
  "T1234-5678",
  "5T12-0408", // T after a digit
  "",
  "   ",
  "TTT",
];

describe("P2 flat codes: text that is not a flat code", () => {
  it("has at least 25 negative strings", () => {
    expect(NOT_FLAT_CODES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(NOT_FLAT_CODES.map((text) => [text]))("finds nothing in %j", (text) => {
    expect(extractFlatTokens(text)).toEqual([]);
  });
});
