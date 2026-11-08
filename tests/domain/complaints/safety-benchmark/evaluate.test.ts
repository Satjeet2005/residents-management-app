import { describe, expect, it } from "vitest";
import { SAFETY_RULES, detectSafetyWords, type SafetyHit } from "@/domain/complaints/safety";
import { buildBase } from "@/domain/complaints/safety-benchmark/base";
import { emptyTally, mergeTallies, rate, summarise, tallyNegatives, tallyPositives, type Detect } from "@/domain/complaints/safety-benchmark/evaluate";
import { NEAR_MISS_WORDS, existingNegatives, generateNegatives } from "@/domain/complaints/safety-benchmark/negatives";
import { makeItem } from "@/domain/complaints/safety-benchmark/perturb";
import { itemRng } from "@/domain/complaints/safety-benchmark/prng";
import { LANGUAGE_FORMS, type BasePhrase, type BenchmarkItem, type LanguageForm } from "@/domain/complaints/safety-benchmark/types";
import { wilson } from "@/domain/complaints/safety-benchmark/wilson";

const hitFor = (rule: string): SafetyHit => ({ rule, category: "FIRE", language: "en", matched: "x" });
/** A stub detector: a text hits rule R1 when it holds "HIT", and R2 as well when it holds "BOTH". */
const stub: Detect = (raw) => (raw.includes("BOTH") ? [hitFor("R1"), hitFor("R2")] : raw.includes("HIT") ? [hitFor("R1")] : []);
const item = (text: string, over: Partial<BenchmarkItem> = {}): BenchmarkItem => ({ text, category: "FIRE", form: "ENGLISH", base: "fire", ruleId: "FIRE_EN_WORD", operations: ["DROP_LETTER"], ...over });

describe("SB3 the Wilson interval", () => {
  it.each([
    [5, 10, 0.2366, 0.7634],
    [0, 10, 0, 0.2775],
    [10, 10, 0.7225, 1],
    [8, 10, 0.4902, 0.9433],
  ])("%i of %i gives %f to %f", (k, n, lo, hi) => {
    const w = wilson(k, n);
    expect(w.lo).toBeCloseTo(lo, 3);
    expect(w.hi).toBeCloseTo(hi, 3);
    expect(w.rate).toBe(k / n);
  });

  it("n = 0 is the whole range, and the interval always contains the rate and stays within 0 and 1", () => {
    expect(wilson(0, 0)).toEqual({ rate: 0, lo: 0, hi: 1 });
    for (const [k, n] of [[1, 1000], [999, 1000], [37, 100], [500, 1000]]) {
      const w = wilson(k, n);
      expect(w.lo <= w.rate && w.rate <= w.hi && w.lo >= 0 && w.hi <= 1).toBe(true);
    }
  });

  it("is narrower with more trials", () => {
    const a = wilson(50, 100);
    const b = wilson(500, 1000);
    expect(b.hi - b.lo).toBeLessThan(a.hi - a.lo);
  });
});

describe("SB3 the evaluator on a hand-built set with known answers", () => {
  const items = [
    item("HIT 1"),
    item("miss 2"),
    item("HIT 3", { category: "GAS", form: "HINDI_DEVANAGARI", ruleId: "GAS_HI_WORD", base: "गैस", operations: ["NUKTA_TOGGLE"] }),
    item("miss 4", { category: "GAS", form: "HINDI_DEVANAGARI", ruleId: "GAS_HI_WORD", base: "गैस", operations: ["NUKTA_TOGGLE"] }),
    item("miss 5", { category: "GAS", form: "HINDI_DEVANAGARI", ruleId: "GAS_HI_WORD", base: "गैस", operations: ["INSERT_JOINER"] }),
  ];
  const t = tallyPositives(items, "single", stub);

  it("counts overall, per category, per form and per operation, and leaves the other set empty", () => {
    expect(t.overall.single).toEqual({ k: 2, n: 5 });
    expect(t.overall.double).toEqual({ k: 0, n: 0 });
    expect(t.byCategory.single).toEqual({ FIRE: { k: 1, n: 2 }, GAS: { k: 1, n: 3 } });
    expect(t.byForm.single).toEqual({ ENGLISH: { k: 1, n: 2 }, HINDI_DEVANAGARI: { k: 1, n: 3 } });
    expect(t.byOperation.single).toEqual({ DROP_LETTER: { k: 1, n: 2 }, NUKTA_TOGGLE: { k: 1, n: 2 }, INSERT_JOINER: { k: 0, n: 1 } });
    expect(t.byRule).toEqual({ FIRE_EN_WORD: { k: 1, n: 2 }, GAS_HI_WORD: { k: 1, n: 3 } });
    expect(t.byBase["GAS_HI_WORD|गैस"]).toEqual({ k: 1, n: 3 });
  });

  it("lists misses by set, form and operation with the first three texts", () => {
    expect(t.misses["single|HINDI_DEVANAGARI|NUKTA_TOGGLE"]).toEqual({ n: 1, examples: ["miss 4"] });
    expect(t.misses["single|ENGLISH|DROP_LETTER"]).toEqual({ n: 1, examples: ["miss 2"] });
    const many = tallyPositives(Array.from({ length: 6 }, (_, i) => item(`miss ${i}`)), "single", stub);
    expect(many.misses["single|ENGLISH|DROP_LETTER"].examples).toEqual(["miss 0", "miss 1", "miss 2"]);
  });

  it("a double-operation item counts under both of its operations, in the double split", () => {
    const d = tallyPositives([item("miss", { operations: ["LEET", "DROP_LETTER"] }), item("HIT", { operations: ["LEET", "DROP_LETTER"] })], "double", stub);
    expect(d.overall.double).toEqual({ k: 1, n: 2 });
    expect(d.byOperation.double).toEqual({ LEET: { k: 1, n: 2 }, DROP_LETTER: { k: 1, n: 2 } });
    expect(d.overall.single).toEqual({ k: 0, n: 0 });
  });

  it("a detector that finds nothing gives recall 0 and one that finds everything gives 1 (a miss is never counted as a hit)", () => {
    expect(tallyPositives(items, "single", () => []).overall.single).toEqual({ k: 0, n: 5 });
    expect(tallyPositives(items, "single", () => [hitFor("R")]).overall.single).toEqual({ k: 5, n: 5 });
  });

  it("false alarms: a hit on a negative counts, by group and by rule, and the list keeps the text", () => {
    const n = tallyNegatives(
      [{ text: "HIT near", group: "NEAR_MISS" }, { text: "BOTH near", group: "NEAR_MISS" }, { text: "quiet", group: "GENERATED" }, { text: "quiet 2", group: "EXISTING" }],
      stub,
    );
    expect(n.negatives).toEqual({ k: 2, n: 4 });
    expect(n.negativesByGroup).toEqual({ NEAR_MISS: { k: 2, n: 2 }, GENERATED: { k: 0, n: 1 }, EXISTING: { k: 0, n: 1 } });
    expect(n.falseAlarmsByRule).toEqual({ R1: 2, R2: 1 });
    expect(n.falseAlarms.map((a) => a.text)).toEqual(["HIT near", "BOTH near"]);
  });

  it("merging tallies adds the counts, keeps the first three examples, and the empty tally is the identity", () => {
    const merged = mergeTallies([t, t]);
    expect(merged.overall.single).toEqual({ k: 4, n: 10 });
    expect(merged.byBase["GAS_HI_WORD|गैस"]).toEqual({ k: 2, n: 6 });
    expect(merged.misses["single|HINDI_DEVANAGARI|NUKTA_TOGGLE"].n).toBe(2);
    expect(mergeTallies([emptyTally(), t])).toEqual(t);
  });

  it("the summary rates every cell, ranks rules worst first and counts the misses", () => {
    const s = summarise(t);
    expect(s.headline.singleOperationRecall).toEqual(rate({ k: 2, n: 5 }));
    expect(s.headline.singleOperationRecall.rate).toBe(0.4);
    expect(s.fragileRules.map((r) => r.key)).toEqual(["GAS_HI_WORD", "FIRE_EN_WORD"]);
    expect(s.missCount).toBe(3);
    expect(s.byForm.single.HINDI_DEVANAGARI.n).toBe(3);
  });
});

describe("SB3 negatives", () => {
  const sizes = { bodies: 100, perForm: 40, nearMiss: 50 };
  const negatives = generateNegatives(301, sizes);
  const base = buildBase().phrases;

  it("makes at least 1,200 benign sentences over five seeds, in three groups, the same for the same seed", () => {
    const total = [301, 302, 303, 304, 305].flatMap((seed) => generateNegatives(seed, sizes)).length + existingNegatives().length;
    expect(total).toBeGreaterThanOrEqual(1200);
    expect(generateNegatives(301, sizes)).toEqual(negatives);
    expect(generateNegatives(302, sizes)).not.toEqual(negatives);
    expect(new Set(negatives.map((n) => n.group))).toEqual(new Set(["GENERATED", "NEAR_MISS"]));
    expect(new Set(existingNegatives().map((n) => n.group))).toEqual(new Set(["EXISTING"]));
  });

  it("no negative equals a base phrase, a perturbed positive, or a positive test case", () => {
    const positives = new Set(base.map((p) => p.text));
    const byForm = Object.fromEntries(LANGUAGE_FORMS.map((f) => [f, base.filter((p) => p.form === f)])) as Record<LanguageForm, BasePhrase[]>;
    for (let i = 0; i < 300; i++) positives.add(makeItem(byForm, LANGUAGE_FORMS, i % 2 === 0 ? 1 : 2, itemRng(301, "neg", i)).text);
    for (const n of [...negatives, ...existingNegatives()]) expect(positives.has(n.text), n.text).toBe(false);
  });

  it("the near-miss words include the brief's examples, and the existing negatives hit nothing", () => {
    for (const word of ["fine", "five", "hire", "wire", "tire", "fare", "gust", "gasket", "gastric", "shocking", "current account", "liftoff", "fireplace", "bloodwork", "blood donation", "knifeblock", "kitchen knife set", "ambulatory"]) {
      expect(NEAR_MISS_WORDS.ENGLISH, word).toContain(word);
    }
    for (const form of LANGUAGE_FORMS) expect(NEAR_MISS_WORDS[form].length).toBeGreaterThanOrEqual(10);
    for (const n of existingNegatives()) expect(detectSafetyWords(n.text), n.text).toEqual([]);
  });

  it("every rule id of a false alarm is a rule of the table", () => {
    const ids = new Set(SAFETY_RULES.map((r) => r.id));
    const t = tallyNegatives(negatives, detectSafetyWords);
    for (const alarm of t.falseAlarms) for (const rule of alarm.rules) expect(ids.has(rule)).toBe(true);
  });
});

describe("SB3 speed", () => {
  const base = buildBase().phrases;
  const byForm = Object.fromEntries(LANGUAGE_FORMS.map((f) => [f, base.filter((p) => p.form === f)])) as Record<LanguageForm, BasePhrase[]>;
  const items = Array.from({ length: 1000 }, (_, i) => makeItem(byForm, LANGUAGE_FORMS, 1, itemRng(301, "speed", i)));

  it("1,000 detections take under 1 second", () => {
    const started = performance.now();
    for (const it of items) detectSafetyWords(it.text);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("the evaluator takes under 0.5 seconds per 1,000 items", () => {
    const started = performance.now();
    tallyPositives(items, "single", detectSafetyWords);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
