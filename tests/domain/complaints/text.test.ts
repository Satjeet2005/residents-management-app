import { describe, expect, it } from "vitest";
import { CATEGORY_CODES, MODEL_URGENCIES, URGENCIES, higherUrgency, isCategoryCode, isModelUrgency, isUrgency } from "@/domain/complaints/taxonomy";
import { MAX_CLASSIFICATION_CHARS, ROMANISED_INDIC_WORDS, detectScript, looksRomanisedIndic, normalizeComplaintText } from "@/domain/complaints/text";

describe("CP0 taxonomy", () => {
  it("has the five categories and four urgencies, and CRITICAL is not a model urgency", () => {
    expect([...CATEGORY_CODES]).toEqual(["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"]);
    expect([...URGENCIES]).toEqual(["CRITICAL", "HIGH", "NORMAL", "LOW"]);
    expect([...MODEL_URGENCIES]).toEqual(["HIGH", "NORMAL", "LOW"]);
    expect(MODEL_URGENCIES.includes("CRITICAL" as never)).toBe(false);
  });

  it.each([
    [isCategoryCode, "LIFT", true],
    [isCategoryCode, "lift", false],
    [isCategoryCode, 3, false],
    [isUrgency, "CRITICAL", true],
    [isUrgency, "URGENT", false],
    [isModelUrgency, "HIGH", true],
    [isModelUrgency, "CRITICAL", false],
    [isModelUrgency, null, false],
  ])("type guard %#", (guard, value, expected) => {
    expect((guard as (v: unknown) => boolean)(value)).toBe(expected);
  });

  it("higherUrgency picks the more urgent", () => {
    expect(higherUrgency("NORMAL", "HIGH")).toBe("HIGH");
    expect(higherUrgency("LOW", "NORMAL")).toBe("NORMAL");
    expect(higherUrgency("CRITICAL", "HIGH")).toBe("CRITICAL");
    expect(higherUrgency("LOW", "LOW")).toBe("LOW");
  });
});

describe("CP1 normalizeComplaintText", () => {
  it.each<[string, string, string]>([
    ["plain text is kept", "water leak in the kitchen", "water leak in the kitchen"],
    ["outer space is trimmed", "   lift is stuck  ", "lift is stuck"],
    ["runs of whitespace become one space", "tap\t\tis \n\n broken", "tap is broken"],
    ["zero-width space is removed", "fi​re", "fire"],
    ["zero-width non-joiner and joiner are removed", "a‌b‍c", "abc"],
    ["a byte order mark is removed", "﻿gas leak", "gas leak"],
    ["Devanagari digits become ASCII", "फ्लैट ४०८ में", "फ्लैट 408 में"],
    ["all ten Devanagari digits", "०१२३४५६७८९", "0123456789"],
    ["NFD becomes NFC", "café", "café"],
    ["a Devanagari nukta composes", "क़", "क़".normalize("NFC") === "क़" ? "क़" : "क़"],
    ["an empty text stays empty", "", ""],
    ["only whitespace is empty", " \n\t ", ""],
    ["emoji are kept", "fire 🔥 now", "fire 🔥 now"],
    ["a non-breaking space is whitespace", "a b", "a b"],
  ])("%s", (_label, raw, expected) => {
    expect(normalizeComplaintText(raw)).toBe(expected);
  });

  it("cuts to 2,000 characters and never splits an emoji", () => {
    expect(Array.from(normalizeComplaintText("a".repeat(5000))).length).toBe(MAX_CLASSIFICATION_CHARS);
    const cut = normalizeComplaintText("🔥".repeat(3000));
    expect(Array.from(cut).length).toBe(MAX_CLASSIFICATION_CHARS);
    expect(cut).not.toContain("�");
  });

  it("is idempotent", () => {
    for (const raw of ["a​ b  ", "४०८", "café ", "x".repeat(2500)]) {
      const once = normalizeComplaintText(raw);
      expect(normalizeComplaintText(once)).toBe(once);
    }
  });

  it("does not throw on odd values", () => {
    expect(() => normalizeComplaintText(undefined as unknown as string)).not.toThrow();
    expect(normalizeComplaintText(null as unknown as string)).toBe("");
  });
});

describe("CP1 detectScript", () => {
  it.each<[string, string, string]>([
    ["English", "The lift is stuck on the fourth floor", "LATIN"],
    ["Hinglish is Latin script", "lift band hai, please jaldi dekho", "LATIN"],
    ["Hindi", "लिफ्ट में फंस गए हैं", "DEVANAGARI"],
    ["Marathi", "लिफ्टमध्ये अडकलो आहे", "DEVANAGARI"],
    ["Hindi with a flat number", "फ्लैट 408 में पानी का रिसाव", "DEVANAGARI"],
    ["half and half", "water paani पानी नल tap leak लीक", "MIXED"],
    ["emoji only", "🔥🔥🔥", "OTHER"],
    ["digits only", "12345", "OTHER"],
    ["Arabic", "مرحبا بالعالم", "OTHER"],
    ["empty", "", "EMPTY"],
    ["blank", "   \n ", "EMPTY"],
  ])("%s is %s", (_label, text, expected) => {
    expect(detectScript(text).script).toBe(expected as ReturnType<typeof detectScript>["script"]);
  });

  it("the shares are of the letters, between 0 and 1, and add up to at most 1", () => {
    const info = detectScript("abc देव");
    expect(info.latinShare).toBeCloseTo(0.5, 5);
    expect(info.devanagariShare).toBeCloseTo(0.5, 5);
    expect(info.latinShare + info.devanagariShare).toBeLessThanOrEqual(1);
    expect(detectScript("hello")).toMatchObject({ latinShare: 1, devanagariShare: 0 });
  });
});

describe("CP1 looksRomanisedIndic", () => {
  it("the word list has at least 40 distinct words", () => {
    expect(new Set(ROMANISED_INDIC_WORDS).size).toBeGreaterThanOrEqual(40);
  });

  it.each([
    "lift band hai",
    "paani nahi aa raha hai",
    "bijli ka bill bahut zyada hai",
    "kachra nahi uthaya",
    "nal se paani leak ho raha hai",
    "mera paani band hai",
    "lift band zali",
    "pani nahi",
    "vij gelI aahe ani lift band aahe",
    "safai nahi hui hai",
    "tap kharab hai",
    "mala pani nahi aahe",
  ])("reads %j as romanised Hindi or Marathi", (text) => {
    expect(looksRomanisedIndic(text)).toBe(true);
  });

  it.each([
    "The water tap is leaking in my kitchen",
    "Please fix the lift on the fourth floor",
    "Garbage has not been collected for three days",
    "There is a band playing outside",
    "Main gate light is not working",
    "",
    "🔥",
    "लिफ्ट बंद है",
    "12345",
  ])("does not read %j as romanised", (text) => {
    expect(looksRomanisedIndic(text)).toBe(false);
  });

  it("a single Hindi word inside an English sentence is a known miss (documented limit)", () => {
    expect(looksRomanisedIndic("There is no paani in the tank since the morning")).toBe(false);
  });
});
