import { describe, expect, it } from "vitest";
import { decideClassification } from "@/domain/complaints/decision";
import { detectSafetyWords } from "@/domain/complaints/safety";
import {
  MAX_CANDIDATE_CHARS,
  MAX_CANDIDATE_TOKENS,
  baseForm,
  collapseElongation,
  foldDevanagariVariants,
  foldLeet,
  normalizeForSafety,
  squashSingleLetters,
} from "@/domain/complaints/safety-normalize";
import { createRng } from "@/domain/complaints/safety-benchmark/prng";

describe("T10c N1 base reading", () => {
  it.each([
    ["FIRE", "fire"],
    ["Fire In The Lift", "fire in the lift"],
    ["ｆｉｒｅ", "fire"],
    ["ﬁre", "fire"],
    ["fîre", "fire"],
    ["gàs léak", "gas leak"],
    ["İ smell gas", "i smell gas"],
    ["f​i‌r‍e", "fire"],
    ["fire️", "fire"],
    ["fi\u{E0101}re", "fire"],
    ["  a   b \n c ", "a b c"],
    ["आग १२", "आग 12"],
    ["आग लगी है", "आग लगी है"],
    ["लिफ्टमध्ये अडकलो", "लिफ्टमध्ये अडकलो"],
    ["", ""],
  ])("%j reads as %j", (raw, expected) => {
    expect(baseForm(raw)).toBe(expected);
  });
});

describe("T10c N2 squashed reading (runs of at least three single letters)", () => {
  it.each([
    ["f i r e", "fire"],
    ["f.i.r.e", "fire"],
    ["f-i-r-e", "fire"],
    ["f_i_r_e", "fire"],
    ["f i r e in tower 3", "fire in tower 3"],
    ["there is g a s smell", "there is gas smell"],
    ["l i f t atak gayi", "lift atak gayi"],
    ["a g g", "agg"],
    ["आ ग ल ग", "आगलग"],
  ])("%j becomes %j", (text, expected) => {
    expect(squashSingleLetters(text)).toBe(expected);
  });

  it.each(["a b", "i am in 5 b", "b 5", "i am 1 of 3", "flat 5 b wing", "a 12 b 34", "आ ग", "water tank is full", "x. y", "a.b", "5 6 7", "tower a b block", "क्ष त्र ज्ञ"])("%j is left alone", (text) => {
    expect(squashSingleLetters(text)).toBe(text);
  });
});

describe("T10c N3 elongation readings (three or more repeats become two, and one)", () => {
  it.each([
    ["fiiire", "fiire", "fire"],
    ["aaaag lagi", "aag lagi", "ag lagi"],
    ["dhuuuuan", "dhuuan", "dhuan"],
    ["smoookkke", "smookke", "smoke"],
    ["आआआग लगी", "आआग लगी", "आग लगी"],
    ["gass", "gass", "gass"],
    ["fire", "fire", "fire"],
    ["booooooom", "boom", "bom"],
  ])("%j gives %j (two) and %j (one)", (text, two, one) => {
    expect(collapseElongation(text, 2)).toBe(two);
    expect(collapseElongation(text, 1)).toBe(one);
  });
});

describe("T10c N4 leet reading, only in words with a Latin letter and a symbol", () => {
  it.each([
    ["f1re", "fire"],
    ["g4s leak", "gas leak"],
    ["sh0ck", "shock"],
    ["l1ft m@dhe 4dakl", "lift madhe adakl"],
    ["$moke", "smoke"],
    ["un4bl3 to g3t 0ut", "unable to get out"],
    ["b1ood", "biood"],
    ["7ap", "tap"],
  ])("%j becomes %j", (text, expected) => {
    expect(foldLeet(text)).toBe(expected);
  });

  it.each(["5th floor", "b 5", "i am 1 of 3", "flat 5b", "10am", "2bhk", "3rd floor", "4 5 7", "@", "$", "100", "rs $ 5", "gate 4", "tower 3 mein"])("%j is left alone", (text) => {
    expect(foldLeet(text)).toBe(text);
  });
});

describe("T10c N5 Devanagari-folded reading", () => {
  it.each([
    ["फ़ंस", "फंस"],
    ["फ़ंस", "फंस"],
    ["क़ल", "कल"],
    ["फँस", "फंस"],
    ["आ‍ग", "आग"],
    ["आ‌ग", "आग"],
    ["ज़ख्मी", "जख्मी"],
    ["आग लगी", "आग लगी"],
  ])("%j becomes %j", (text, expected) => {
    expect(foldDevanagariVariants(text)).toBe(expected);
  });
});

describe("T10c N6 normalizeForSafety", () => {
  it("gives nothing for an empty or blank text, and never fails on a value that is not text", () => {
    expect(normalizeForSafety("")).toEqual([]);
    expect(normalizeForSafety("   ​  ")).toEqual([]);
    expect(normalizeForSafety(undefined as unknown as string)).toEqual([]);
    expect(normalizeForSafety(null as unknown as string)).toEqual([]);
    expect(normalizeForSafety(42 as unknown as string)).toHaveLength(1);
  });

  it("lists the readings in a fixed order, each labelled, and leaves out one that equals an earlier one", () => {
    expect(normalizeForSafety("hello world")).toEqual([{ via: "NORMALISED", text: "hello world" }]);
    expect(normalizeForSafety("F i r e")).toEqual([
      { via: "NORMALISED", text: "f i r e" },
      { via: "SQUASHED", text: "fire" },
    ]);
    expect(normalizeForSafety("fiiire f1re")).toEqual([
      { via: "NORMALISED", text: "fiiire f1re" },
      { via: "ELONGATION", text: "fiire f1re" },
      { via: "ELONGATION", text: "fire f1re" },
      { via: "LEET", text: "fiiire fire" },
    ]);
    expect(normalizeForSafety("फँस")).toEqual([
      { via: "NORMALISED", text: "फँस" },
      { via: "NORMALISED", text: "फंस" },
    ]);
  });

  it("derives every reading from the raw text on its own: a stretched and leet word needs both and gets neither", () => {
    expect(normalizeForSafety("f1iire").map((c) => c.text)).not.toContain("fire");
  });

  it("is idempotent: each transform applied to its own result changes nothing", () => {
    for (const text of ["f i r e", "fiiire", "f1re", "फँस", "FÎRE", "a  b", "ｆｉｒｅ", "5th floor"]) {
      expect(baseForm(baseForm(text))).toBe(baseForm(text));
      expect(squashSingleLetters(squashSingleLetters(text))).toBe(squashSingleLetters(text));
      expect(collapseElongation(collapseElongation(text, 2), 2)).toBe(collapseElongation(text, 2));
      expect(collapseElongation(collapseElongation(text, 1), 1)).toBe(collapseElongation(text, 1));
      expect(foldLeet(foldLeet(text))).toBe(foldLeet(text));
      expect(foldDevanagariVariants(foldDevanagariVariants(text))).toBe(foldDevanagariVariants(text));
    }
  });
});

const ALPHABET = [
  ..."abcdefghijklmnopqrstuvwxyzABCXYZ0123456789 .,;:!?-_/@$'\"()[]",
  ..."आगलफंसिटमेंधुआगैसकरंटझ्टकाशॉक अडकल",
  ..."़ँंाे०९क़फ़",
  ..."🔥💥😀👍🏽",
  ..."\u0000\u0007\u001B\u007F​‌‍﻿️  　",
  ..."ÀéîõüçñŁİıßﬁｆ̀́",
  "\uD800",
  "\uDC00",
];

describe("T10c N7 properties over 2,000 seeded random strings", () => {
  it("never throws, gives at most 6 readings, each within 2,000 characters and 400 words, and the detector never throws", () => {
    const rng = createRng(20261108);
    for (let i = 0; i < 2000; i++) {
      const length = rng.int(0, i % 10 === 0 ? 1500 : 60);
      const text = Array.from({ length }, () => rng.pick(ALPHABET)).join("");
      const readings = normalizeForSafety(text);
      expect(readings.length).toBeLessThanOrEqual(6);
      for (const reading of readings) {
        expect(Array.from(reading.text).length).toBeLessThanOrEqual(MAX_CANDIDATE_CHARS);
        expect(reading.text.split(" ").length).toBeLessThanOrEqual(MAX_CANDIDATE_TOKENS);
        expect(reading.text).not.toBe("");
      }
      expect(Array.isArray(detectSafetyWords(text))).toBe(true);
    }
  });

  it("each transform is idempotent on random strings", () => {
    const rng = createRng(77);
    for (let i = 0; i < 2000; i++) {
      const text = Array.from({ length: rng.int(0, 40) }, () => rng.pick(ALPHABET)).join("");
      const once = baseForm(text);
      expect(baseForm(once), JSON.stringify(text)).toBe(once);
      expect(squashSingleLetters(squashSingleLetters(once))).toBe(squashSingleLetters(once));
      expect(foldLeet(foldLeet(once))).toBe(foldLeet(once));
      expect(collapseElongation(collapseElongation(once, 2), 2)).toBe(collapseElongation(once, 2));
      expect(foldDevanagariVariants(foldDevanagariVariants(once))).toBe(foldDevanagariVariants(once));
    }
  });
});

describe("T10c N8 cost bound: a 5,000-character adversarial text is read in under 50 ms", () => {
  const adversarial: [string, string][] = [
    ["single letters", "a ".repeat(2500)],
    ["dotted letters", "a.".repeat(2500)],
    ["one letter 5,000 times", "a".repeat(5000)],
    ["leet symbols", "4 ".repeat(2500)],
    ["leet words", "g4s ".repeat(1250)],
    ["zero-width characters", "f​".repeat(2500)],
    ["a long run then a long word", `${"a ".repeat(2000)}${"b".repeat(1000)}`],
    ["Devanagari marks", "आ़ँ".repeat(1666)],
    ["mixed separators", "a-b_c.d e ".repeat(500)],
  ];
  it.each(adversarial)("%s", (_name, text) => {
    expect(text.length).toBeGreaterThanOrEqual(4990);
    const start = performance.now();
    normalizeForSafety(text);
    detectSafetyWords(text);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("T10c N9 the detector reads the extra readings and says how it found each hit", () => {
  const viaOf = (text: string, rule: string) => detectSafetyWords(text).find((h) => h.rule === rule)?.via;

  it.each([
    ["fire", "FIRE_EN_WORD", "EXACT"],
    ["THE FIRE IS BIG", "FIRE_EN_WORD", "EXACT"],
    ["fîre in the lobby", "FIRE_EN_WORD", "NORMALISED"],
    ["ｆｉｒｅ in the lobby", "FIRE_EN_WORD", "NORMALISED"],
    ["f i r e in the lobby", "FIRE_EN_WORD", "SQUASHED"],
    ["f.i.r.e in the lobby", "FIRE_EN_WORD", "SQUASHED"],
    ["fiiire in the lobby", "FIRE_EN_WORD", "ELONGATION"],
    ["f1re in the lobby", "FIRE_EN_WORD", "LEET"],
    ["g4s leak in b wing", "GAS_EN_LEAK", "LEET"],
    ["sh0ck laga", "SHOCK_HI_LATN_SHOCK", "LEET"],
    ["aaaag lagi hai", "FIRE_HI_LATN_PHRASE", "ELONGATION"],
    ["l i f t atak gayi", "LIFT_HI_LATN_ATAK", "SQUASHED"],
  ])("%j: rule %s found %s", (text, rule, via) => {
    expect(viaOf(text, rule)).toBe(via);
  });

  it("a hit is STRONG whichever reading found it: CRITICAL, flagged, escalated", () => {
    for (const text of ["f i r e in the lobby", "fiiire in the lobby", "f1re in the lobby", "fîre in the lobby", "g4s leak in b wing"]) {
      const decision = decideClassification({ rawText: text, arms: [] });
      expect(decision.urgency, text).toBe("CRITICAL");
      expect(decision.safetyFlag, text).toBe(true);
      expect(decision.escalateToDutyManager, text).toBe(true);
      expect(decision.safetyHits.length, text).toBeGreaterThan(0);
    }
  });

  it("names each rule once and keeps the exact hit when two readings find the same rule", () => {
    const hits = detectSafetyWords("fire and f i r e and f1re");
    expect(hits.filter((h) => h.rule === "FIRE_EN_WORD")).toHaveLength(1);
    expect(hits.find((h) => h.rule === "FIRE_EN_WORD")?.via).toBe("EXACT");
  });

  it("the raw text is never changed", () => {
    const raw = "F i r e  in   B wing";
    const copy = String(raw);
    detectSafetyWords(raw);
    normalizeForSafety(raw);
    expect(raw).toBe(copy);
  });

  it("adds no false alarm to ordinary sentences that hold small words, numbers and single letters", () => {
    for (const text of [
      "I am in 5 B",
      "flat 5b wing a",
      "5th floor lift display",
      "B 5 parking slot",
      "I am 1 of 3 owners",
      "tower a b c block notice",
      "the 4th and 7th floor passage light",
      "rs 5000 maintenance 3rd quarter",
      "gate 4 visitor register",
      "coool weather in the garden",
      "pls hlp wid the bench",
      "water tank cleaning on 10am",
    ]) {
      expect(detectSafetyWords(text), text).toEqual([]);
    }
  });
});
