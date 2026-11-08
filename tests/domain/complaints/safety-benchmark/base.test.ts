import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SAFETY_RULES, detectSafetyWords } from "@/domain/complaints/safety";
import { buildBase } from "@/domain/complaints/safety-benchmark/base";
import { CONTEXTS, embed } from "@/domain/complaints/safety-benchmark/contexts";
import { TEST_NEGATIVES } from "@/domain/complaints/safety-benchmark/test-negatives";
import { TEST_POSITIVES } from "@/domain/complaints/safety-benchmark/test-positives";
import { LANGUAGE_FORMS, SAFETY_CATEGORIES } from "@/domain/complaints/safety-benchmark/types";
import { MV_NEGATIVES, MV_POSITIVES } from "../medical-violence-cases";

const base = buildBase();
const quoted = (block: string) => [...block.matchAll(/^\s*\[("(?:[^"\\]|\\.)*"), "([A-Z_]+)"\],?$/gm)].map((m) => [JSON.parse(m[1]) as string, m[2]] as const);

describe("SB1 base phrases", () => {
  it("every rule has at least one base phrase", () => {
    const covered = new Set(base.phrases.map((p) => p.ruleId));
    expect(SAFETY_RULES.filter((r) => !covered.has(r.id)).map((r) => r.id)).toEqual([]);
  });

  it("every base phrase is detected unperturbed, by the rule it names, with that rule's category", () => {
    for (const phrase of base.phrases) {
      const hit = detectSafetyWords(phrase.text).find((h) => h.rule === phrase.ruleId);
      expect(hit, `${phrase.ruleId} ${phrase.text}`).toBeDefined();
      expect(hit?.category).toBe(phrase.category);
    }
  });

  it("has no duplicate (rule, text) pair, and no dropped phrase is detected by its own rule", () => {
    const keys = base.phrases.map((p) => `${p.ruleId}|${p.text}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of base.dropped) expect(detectSafetyWords(d.text).some((h) => h.rule === d.ruleId), `${d.ruleId} ${d.text}`).toBe(false);
  });

  it("covers all five categories and all five language forms", () => {
    expect(new Set(base.phrases.map((p) => p.category))).toEqual(new Set(SAFETY_CATEGORIES));
    expect(new Set(base.phrases.map((p) => p.form))).toEqual(new Set(LANGUAGE_FORMS));
  });

  it("includes every term of the rule table that its own rule detects, and the words of the test cases", () => {
    const texts = new Set(base.phrases.map((p) => `${p.ruleId}|${p.text}`));
    expect(texts.has("FIRE_EN_WORD|fire")).toBe(true);
    for (const [sentence, ruleId] of TEST_POSITIVES) {
      const hit = detectSafetyWords(sentence).find((h) => h.rule === ruleId);
      expect(texts.has(`${ruleId}|${hit?.matched}`), `${ruleId} ${sentence}`).toBe(true);
    }
  });

  it("reports the counts per category and per language form", () => {
    const perCategory = Object.fromEntries(SAFETY_CATEGORIES.map((c) => [c, base.phrases.filter((p) => p.category === c).length]));
    const perForm = Object.fromEntries(LANGUAGE_FORMS.map((f) => [f, base.phrases.filter((p) => p.form === f).length]));
    console.info("base phrases", base.phrases.length, "dropped", base.dropped.length, perCategory, perForm);
    for (const n of [...Object.values(perCategory), ...Object.values(perForm)]) expect(n).toBeGreaterThan(0);
  });
});

describe("SB1 the copied test lists equal the frozen tests", () => {
  const safetyTest = readFileSync("tests/domain/complaints/safety.test.ts", "utf8");
  const block = safetyTest.slice(safetyTest.indexOf("const POSITIVES"), safetyTest.indexOf("\n];", safetyTest.indexOf("const POSITIVES")));

  it("TEST_POSITIVES holds every positive case of safety.test.ts and of the medical and violence cases", () => {
    const copied = new Set(TEST_POSITIVES.map(([t, r]) => `${r}|${t}`));
    for (const [t, r] of [...MV_POSITIVES, ...quoted(block)]) expect(copied.has(`${r}|${t}`), `${r} ${t}`).toBe(true);
    expect(TEST_POSITIVES.length).toBe(new Set([...MV_POSITIVES, ...quoted(block)].map(([t, r]) => `${r}|${t}`)).size);
  });

  it("TEST_NEGATIVES holds the medical and violence negatives and hits nothing", () => {
    for (const text of MV_NEGATIVES) expect(TEST_NEGATIVES).toContain(text);
    for (const text of TEST_NEGATIVES) expect(detectSafetyWords(text), text).toEqual([]);
  });
});

describe("SB1 contexts", () => {
  it.each(LANGUAGE_FORMS)("%s has at least 40 distinct contexts with one placeholder, and none holds a safety word", (form) => {
    const contexts = CONTEXTS[form];
    expect(contexts.length).toBeGreaterThanOrEqual(40);
    expect(new Set(contexts).size).toBe(contexts.length);
    for (const context of contexts) {
      expect(context.split("{}").length, context).toBe(2);
      expect(detectSafetyWords(embed(context, "")), context).toEqual([]);
      expect(detectSafetyWords(embed(context, "xyz")), context).toEqual([]);
    }
  });

  it("embed puts the phrase in the placeholder, even a phrase with dollar signs", () => {
    expect(embed("a {} b", "f$&re")).toBe("a f$&re b");
  });
});
