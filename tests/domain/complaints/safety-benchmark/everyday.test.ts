import { describe, expect, it } from "vitest";
import { decideClassification } from "@/domain/complaints/decision";
import { detectSafetyWords } from "@/domain/complaints/safety";
import { AMBIGUOUS_PHRASES, EVERYDAY_PHRASES, everydayNegatives } from "@/domain/complaints/safety-benchmark/negatives";
import { LANGUAGE_FORMS } from "@/domain/complaints/safety-benchmark/types";

/** The rules whose bare "current" or "करंट" term is the electricity current of a bill or a power cut (the family D169 narrows). */
const CURRENT_FAMILY = new Set(["SHOCK_HI_KARANT", "SHOCK_MR_KARANT", "SHOCK_HI_LAG", "SHOCK_HI_LATN_CURRENT", "SHOCK_HI_LATN_JHATKA"]);

const hitsOf = (texts: readonly string[]) => texts.filter((t) => detectSafetyWords(t).length > 0);

describe("T10c everyday Indian phrasing: the group", () => {
  const everyday = LANGUAGE_FORMS.flatMap((form) => EVERYDAY_PHRASES[form]);

  it("has at least 150 sentences, at least 15 in each language form, none repeated", () => {
    expect(everyday.length).toBeGreaterThanOrEqual(150);
    for (const form of LANGUAGE_FORMS) expect(EVERYDAY_PHRASES[form].length).toBeGreaterThanOrEqual(15);
    expect(new Set(everyday).size).toBe(everyday.length);
    expect(new Set([...everyday, ...AMBIGUOUS_PHRASES]).size).toBe(everyday.length + AMBIGUOUS_PHRASES.length);
  });

  it("names the phrases the brief lists", () => {
    const all = new Set(everyday);
    for (const phrase of ["Current bill is very high this month", "current gaya hai kab aayega", "current gela aahe sakalpasun", "current kab aayega bhai", "light nahi hai subah se", "bijli gayi hai subah se", "Power cut since morning in B wing", "तीन तासांपासून करंट नाही", "विजेचे बिल खूप जास्त आले आहे"]) {
      const near = [...all].some((t) => t.toLowerCase().startsWith(phrase.toLowerCase().slice(0, 18)));
      expect(near, phrase).toBe(true);
    }
  });

  it("puts the four ambiguous sentences of the brief in their own list", () => {
    const joined = AMBIGUOUS_PHRASES.join("\n");
    for (const part of ["Fire extinguisher is empty", "Lift stuck on the 5th floor but nobody inside", "Water leak near the electric meter", "Smell of burning from the neighbour's kitchen"]) expect(joined).toContain(part);
  });

  it("labels each sentence EVERYDAY or AMBIGUOUS, so the ambiguous ones are not counted as false alarms", () => {
    const items = everydayNegatives();
    expect(items.filter((i) => i.group === "EVERYDAY")).toHaveLength(everyday.length);
    expect(items.filter((i) => i.group === "AMBIGUOUS")).toHaveLength(AMBIGUOUS_PHRASES.length);
  });
});

describe("T10c everyday Indian phrasing: what the detector does", () => {
  const everyday = LANGUAGE_FORMS.flatMap((form) => EVERYDAY_PHRASES[form]);

  it("counts the everyday sentences that hit a rule, by language form (the measurement)", () => {
    const byForm = Object.fromEntries(LANGUAGE_FORMS.map((form) => [form, hitsOf(EVERYDAY_PHRASES[form]).length]));
    expect(byForm).toEqual({ ENGLISH: 36, HINDI_DEVANAGARI: 7, MARATHI_DEVANAGARI: 6, ROMANISED_HINDI: 16, ROMANISED_MARATHI: 6 });
    expect(hitsOf(everyday)).toHaveLength(71);
  });

  it("counts the ambiguous sentences that hit a rule (reported apart; a hit is acceptable)", () => {
    expect(hitsOf(AMBIGUOUS_PHRASES)).toHaveLength(9);
  });

  it("counts the everyday electricity sentences that hit through a bare current rule (17 before D169, 0 after)", () => {
    expect(everyday.filter((t) => detectSafetyWords(t).some((h) => CURRENT_FAMILY.has(h.rule)))).toHaveLength(0);
  });

  it("makes every hit CRITICAL through the decision path (a strong hit is CRITICAL)", () => {
    for (const text of [...hitsOf(everyday), ...hitsOf(AMBIGUOUS_PHRASES)]) {
      const decision = decideClassification({ rawText: text, arms: [] });
      expect(decision.urgency, text).toBe("CRITICAL");
      expect(decision.safetyFlag, text).toBe(true);
      expect(decision.escalateToDutyManager, text).toBe(true);
    }
  });

  it("does not hit the Latin electricity phrases that have no shock word (current gaya, current gela, current kab aayega, light gayi)", () => {
    for (const text of ["current gaya", "current gela", "current kab aayega", "light gayi", "current bill", "power cut since morning"]) expect(detectSafetyWords(text), text).toEqual([]);
  });
});
