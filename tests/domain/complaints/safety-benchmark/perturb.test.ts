import { describe, expect, it } from "vitest";
import { buildBase } from "@/domain/complaints/safety-benchmark/base";
import { OPERATIONS, operationsFor } from "@/domain/complaints/safety-benchmark/operations";
import { GENERATOR_VERSION, makeItem, perturbPhrase } from "@/domain/complaints/safety-benchmark/perturb";
import { createRng, itemRng, mixSeed, type Rng } from "@/domain/complaints/safety-benchmark/prng";
import { LANGUAGE_FORMS, type BasePhrase, type LanguageForm } from "@/domain/complaints/safety-benchmark/types";

/** A stub that always takes the first candidate, so each operation's first possible result can be written down. */
const first: Rng = { next: () => 0, int: (min) => min, pick: (list) => list[0], shuffle: (list) => [...list] };
const op = (name: string) => OPERATIONS.find((o) => o.name === name)!;

describe("SB2 the generator's own random numbers", () => {
  it("the same seed gives the same numbers, another seed gives others, and every number is in [0, 1)", () => {
    const a = createRng(7);
    const b = createRng(7);
    const run = (r: Rng) => Array.from({ length: 50 }, () => r.next());
    expect(run(a)).toEqual(run(b));
    expect(run(createRng(8))).not.toEqual(run(createRng(7)));
    for (const n of run(createRng(1))) expect(n >= 0 && n < 1).toBe(true);
  });

  it("int is inclusive, shuffle keeps the items, and item generators do not depend on each other", () => {
    const r = createRng(3);
    const seen = new Set(Array.from({ length: 300 }, () => r.int(2, 4)));
    expect([...seen].sort()).toEqual([2, 3, 4]);
    expect(createRng(5).shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(itemRng(301, "single", 4).next()).toBe(itemRng(301, "single", 4).next());
    expect(itemRng(301, "single", 4).next()).not.toBe(itemRng(301, "single", 5).next());
    expect(mixSeed(301, "single:4")).not.toBe(mixSeed(302, "single:4"));
  });
});

describe("SB2 each operation: first possible result, and what it cannot change", () => {
  const TABLE: [string, string, string][] = [
    ["SWAP_ADJACENT", "fire", "ifre"],
    ["DROP_LETTER", "fire", "ire"],
    ["DOUBLE_LETTER", "fire", "ffire"],
    ["INSERT_NEIGHBOUR", "fire", "dfire"],
    ["SUBSTITUTE_NEIGHBOUR", "fire", "dire"],
    ["ELONGATE_VOWEL", "fire", "fiiire"],
    ["RANDOM_CASE", "fire", "FIRE"],
    ["INSERT_SEPARATOR", "fire", "f ire"],
    ["REMOVE_SPACES", "gas leak", "gasleak"],
    ["REMOVE_SPACES", "short-circuit", "shortcircuit"],
    ["LEET", "fire", "f1r3"],
    ["ROMANISATION_VARIANT", "aag", "ag"],
    ["ROMANISATION_VARIANT", "dhuan", "dhuaan"],
    ["NUKTA_TOGGLE", "आग", "आग़"],
    ["NUKTA_TOGGLE", "आग़", "आग"],
    ["CHANDRABINDU_ANUSVARA", "फँस", "फंस"],
    ["CHANDRABINDU_ANUSVARA", "फंस", "फँस"],
    ["INSERT_JOINER", "आग", "आ\u200dग"],
    ["SWAP_VOWEL_LENGTH", "लिफ्ट", "लीफ्ट"],
    ["SWAP_VOWEL_LENGTH", "धूर", "धुर"],
    ["DROP_VOWEL_SIGN", "लिफ्ट", "लफ्ट"],
    ["DOUBLE_CONSONANT", "आग", "आगग"],
  ];
  it.each(TABLE)("%s on %j gives %j", (name, input, expected) => {
    expect(op(name).apply(input, first)).toBe(expected);
  });

  it.each([
    ["SWAP_ADJACENT", "aa"],
    ["DROP_LETTER", "a"],
    ["REMOVE_SPACES", "fire"],
    ["LEET", "xyz"],
    ["ELONGATE_VOWEL", "xyz"],
    ["ROMANISATION_VARIANT", ""],
    ["CHANDRABINDU_ANUSVARA", "आग"],
    ["DROP_VOWEL_SIGN", "आग"],
    ["SWAP_VOWEL_LENGTH", "आग"],
    ["INSERT_JOINER", "आ"],
    ["DOUBLE_CONSONANT", "ai"],
    ["NUKTA_TOGGLE", "लट"],
  ])("%s on %j is a no-op and returns null", (name, input) => {
    expect(op(name).apply(input, first)).toBeNull();
  });

  it("never returns the input unchanged, for 100 seeds on a spread of phrases, and Latin operations leave Devanagari alone", () => {
    const phrases = ["fire", "gas leak", "lift stuck between floors", "short-circuit", "आग लगी", "लिफ्ट में फँस", "धुआं", "aag lagi", "dhuvan"];
    for (const operation of OPERATIONS) {
      for (const phrase of phrases) {
        for (let seed = 1; seed <= 100; seed++) {
          const out = operation.apply(phrase, createRng(seed));
          if (out !== null) expect(out, `${operation.name} ${phrase}`).not.toBe(phrase);
        }
      }
    }
    for (const latin of OPERATIONS.filter((o) => !o.scripts.includes("DEVANAGARI"))) expect(latin.apply("आग लगी", createRng(1)), latin.name).toBeNull();
  });

  it("keeps every operation: 17 of them, and each language form skips the ones for the other scripts", () => {
    expect(OPERATIONS.length).toBe(17);
    expect(operationsFor("ENGLISH").map((o) => o.name)).toEqual(OPERATIONS.slice(0, 10).map((o) => o.name));
    expect(operationsFor("ROMANISED_HINDI").length).toBe(11);
    expect(operationsFor("HINDI_DEVANAGARI").map((o) => o.name)).toEqual(OPERATIONS.slice(11).map((o) => o.name));
    expect(operationsFor("MARATHI_DEVANAGARI")).toEqual(operationsFor("HINDI_DEVANAGARI"));
  });
});

describe("SB2 perturbing a phrase", () => {
  it("one operation gives one name, two give two different names, and the text always differs", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const single = perturbPhrase("gas leak", "ENGLISH", 1, createRng(seed));
      const double = perturbPhrase("gas leak", "ENGLISH", 2, createRng(seed));
      expect(single?.operations.length).toBe(1);
      expect(single?.text).not.toBe("gas leak");
      expect(double?.operations.length).toBe(2);
      expect(new Set(double?.operations).size).toBe(2);
      expect(double?.text).not.toBe("gas leak");
    }
  });

  it("is deterministic for a seed", () => {
    expect(perturbPhrase("lift stuck", "ENGLISH", 2, createRng(9))).toEqual(perturbPhrase("lift stuck", "ENGLISH", 2, createRng(9)));
  });

  it("returns null when the phrase cannot be changed that many ways", () => {
    expect(perturbPhrase("", "ENGLISH", 1, createRng(1))).toBeNull();
  });

  it("every operation is reachable as the only operation of some item of its form", () => {
    const base = buildBase().phrases;
    for (const form of LANGUAGE_FORMS) {
      const reached = new Set<string>();
      for (let seed = 1; seed <= 400; seed++) {
        const phrase = base.filter((p) => p.form === form)[seed % base.filter((p) => p.form === form).length];
        const out = perturbPhrase(phrase.text, form, 1, createRng(seed));
        if (out !== null) reached.add(out.operations[0]);
      }
      const names = operationsFor(form).map((o) => o.name);
      const missing = names.filter((n) => !reached.has(n));
      // Chandrabindu needs a phrase that has one: it is allowed to be absent where no base phrase of the form has it.
      expect(missing.filter((n) => n !== "CHANDRABINDU_ANUSVARA"), form).toEqual([]);
    }
  });
});

describe("SB2 items", () => {
  const phrases = buildBase().phrases;
  const byForm = Object.fromEntries(LANGUAGE_FORMS.map((f) => [f, phrases.filter((p) => p.form === f)])) as Record<LanguageForm, BasePhrase[]>;

  it("an item names its truth: the base phrase, its rule and category, the operations, and the text holds a changed phrase inside a context", () => {
    for (let i = 0; i < 300; i++) {
      const item = makeItem(byForm, LANGUAGE_FORMS, i % 2 === 0 ? 1 : 2, itemRng(301, "x", i));
      const base = phrases.find((p) => p.text === item.base && p.ruleId === item.ruleId);
      expect(base, item.text).toBeDefined();
      expect(base?.category).toBe(item.category);
      expect(base?.form).toBe(item.form);
      expect(item.operations.length).toBe(i % 2 === 0 ? 1 : 2);
      expect(item.text).not.toBe(item.base);
    }
  });

  it("is the same item for the same seed and index, and the version string is set", () => {
    expect(makeItem(byForm, LANGUAGE_FORMS, 1, itemRng(301, "single", 0))).toEqual(makeItem(byForm, LANGUAGE_FORMS, 1, itemRng(301, "single", 0)));
    expect(GENERATOR_VERSION).toMatch(/^safety-perturb-\d+$/);
  });
});
