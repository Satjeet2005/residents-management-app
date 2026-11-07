import { describe, expect, it } from "vitest";
import { COMPLAINT_BODY_MAX, NO_DESCRIPTION, isBlankBody, prepareComplaintBody, repeatKey, scriptLabel } from "@/domain/complaints/body";

describe("CL2 prepareComplaintBody", () => {
  it("CL2 keeps the words as written, trimmed, with lines and tabs", () => {
    expect(prepareComplaintBody("  Water LEAK\nunder\tthe sink  ")).toBe("Water LEAK\nunder\tthe sink");
    expect(prepareComplaintBody("नल से पानी  टपक रहा है")).toBe("नल से पानी  टपक रहा है");
  });
  it("CL2 removes control characters, including a carriage return and the DEL and C1 range", () => {
    expect(prepareComplaintBody("a\u0000b\u0007c\r\nd\u007fe\u0085f")).toBe("abc\ndef");
  });
  it("CL2 refuses blank, non-text and over-long text; 2,000 characters are fine and 2,001 are not (characters, not UTF-16 units)", () => {
    for (const bad of ["", "  \n ", "\u0000", 5, null, undefined, {}, []]) expect(prepareComplaintBody(bad)).toBeNull();
    expect(prepareComplaintBody("x".repeat(COMPLAINT_BODY_MAX))).not.toBeNull();
    expect(prepareComplaintBody("x".repeat(COMPLAINT_BODY_MAX + 1))).toBeNull();
    expect(prepareComplaintBody("😀".repeat(COMPLAINT_BODY_MAX))).not.toBeNull();
    expect(prepareComplaintBody("😀".repeat(COMPLAINT_BODY_MAX + 1))).toBeNull();
  });
});

describe("CL2 scriptLabel and repeatKey", () => {
  it("CL2 labels LATIN, DEVANAGARI and MIXED, and nothing for a text with no letters", () => {
    expect(scriptLabel("water leak")).toBe("LATIN");
    expect(scriptLabel("mere ghar mein paani aa raha hai")).toBe("LATIN");
    expect(scriptLabel("नल से पानी टपक रहा है")).toBe("DEVANAGARI");
    expect(scriptLabel("bathroom में नल से पानी leak हो रहा है")).toBe("MIXED");
    expect(scriptLabel("12345 😀")).toBeNull();
  });
  it("CL8 the repeat key ignores case, spacing and zero-width characters, and nothing else", () => {
    expect(repeatKey("  Water   LEAK\n under the sink ")).toBe(repeatKey("water leak under the sink"));
    expect(repeatKey("water leak")).not.toBe(repeatKey("water leaks"));
  });
});

describe("D121 isBlankBody", () => {
  it("is true for text that is empty after control characters and spaces go, false for words, and false for a value that is not text", () => {
    for (const blank of ["", "  ", "\n\t ", "\u0000\u0007"]) expect(isBlankBody(blank)).toBe(true);
    for (const other of ["a", " fire ", 0, null, undefined, {}]) expect(isBlankBody(other)).toBe(false);
    expect(NO_DESCRIPTION).toBe("(no description)");
  });
});
