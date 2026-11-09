import { describe, expect, it } from "vitest";
import { BENCHMARK_ITEMS, LANGUAGE_GROUPS } from "@/domain/complaints/classifier-benchmark/dataset";
import { deidentify } from "@/domain/complaints/deidentify";
import { detectSafetyWords } from "@/domain/complaints/safety";
import { CATEGORY_CODES, MODEL_URGENCIES } from "@/domain/complaints/taxonomy";

const DEVANAGARI = /[ऀ-ॿ]/;
const cells = CATEGORY_CODES.flatMap((category) => LANGUAGE_GROUPS.map((group) => ({ category, group, items: BENCHMARK_ITEMS.filter((i) => i.category === category && i.languageGroup === group) })));

describe("BD1 the synthetic classifier benchmark dataset", () => {
  it("has 200 items: 5 categories x 4 language groups x 10", () => {
    expect(BENCHMARK_ITEMS).toHaveLength(200);
    expect(cells).toHaveLength(20);
    for (const cell of cells) expect(cell.items, `${cell.group} ${cell.category}`).toHaveLength(10);
  });

  it("has in every cell exactly 2 HIGH, 6 NORMAL and 2 LOW, and exactly 2 hard items", () => {
    for (const cell of cells) {
      for (const [urgency, n] of [["HIGH", 2], ["NORMAL", 6], ["LOW", 2]] as const) expect(cell.items.filter((i) => i.urgency === urgency), `${cell.group} ${cell.category} ${urgency}`).toHaveLength(n);
      expect(cell.items.filter((i) => i.hard), `${cell.group} ${cell.category} hard`).toHaveLength(2);
    }
  });

  it("has unique ids and unique texts", () => {
    expect(new Set(BENCHMARK_ITEMS.map((i) => i.id)).size).toBe(200);
    expect(new Set(BENCHMARK_ITEMS.map((i) => i.text)).size).toBe(200);
  });

  it("uses valid category codes and model urgencies, and the language groups it names", () => {
    for (const item of BENCHMARK_ITEMS) {
      expect((CATEGORY_CODES as readonly string[]).includes(item.category), item.id).toBe(true);
      expect((MODEL_URGENCIES as readonly string[]).includes(item.urgency), item.id).toBe(true);
      expect((LANGUAGE_GROUPS as readonly string[]).includes(item.languageGroup), item.id).toBe(true);
    }
  });

  it("has no strong safety hit in any text (safety complaints never go to a model)", () => {
    const hits = BENCHMARK_ITEMS.filter((i) => detectSafetyWords(i.text).length > 0).map((i) => `${i.id}: ${detectSafetyWords(i.text).map((h) => h.rule).join(",")}`);
    expect(hits).toEqual([]);
  });

  it("is unchanged by de-identification (no names, phones, flat codes or emails)", () => {
    const changed = BENCHMARK_ITEMS.filter((i) => deidentify(i.text, { knownNames: [] }).text !== i.text).map((i) => i.id);
    expect(changed).toEqual([]);
  });

  it("has texts of 15 to 200 characters", () => {
    for (const item of BENCHMARK_ITEMS) {
      expect(item.text.length, item.id).toBeGreaterThanOrEqual(15);
      expect(item.text.length, item.id).toBeLessThanOrEqual(200);
    }
  });

  it("writes HI and MR in Devanagari and EN and HINGLISH with no Devanagari, and Hindi and Marathi are not copies", () => {
    for (const item of BENCHMARK_ITEMS) expect(DEVANAGARI.test(item.text), item.id).toBe(item.languageGroup === "HI" || item.languageGroup === "MR");
    for (const category of CATEGORY_CODES) {
      const hindi = BENCHMARK_ITEMS.filter((i) => i.category === category && i.languageGroup === "HI").map((i) => i.text);
      const marathi = BENCHMARK_ITEMS.filter((i) => i.category === category && i.languageGroup === "MR").map((i) => i.text);
      expect(hindi.filter((t) => marathi.includes(t))).toEqual([]);
    }
  });

  it("is deterministic: the order is category, language group, position", () => {
    expect(BENCHMARK_ITEMS[0].id).toBe("EN-PLUMBING-01");
    expect(BENCHMARK_ITEMS[199].id).toBe("HINGLISH-OTHER-10");
    expect(BENCHMARK_ITEMS.map((i) => i.id)).toEqual(BENCHMARK_ITEMS.map((i) => i.id).slice());
  });
});
