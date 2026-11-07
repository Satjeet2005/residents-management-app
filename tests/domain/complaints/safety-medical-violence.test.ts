import { describe, expect, it } from "vitest";
import { decideClassification } from "@/domain/complaints/decision";
import { SAFETY_RULES, type SafetyLanguage, detectSafetyWords } from "@/domain/complaints/safety";
import { MV_ACCEPTED_FALSE_POSITIVES, MV_NEGATIVES, MV_POSITIVES } from "./medical-violence-cases";

const MV_RULES = SAFETY_RULES.filter((r) => r.category === "MEDICAL_VIOLENCE");
const FAMILIES: SafetyLanguage[] = ["en", "hi", "mr", "hi-Latn", "mr-Latn"];

describe("D153 MEDICAL_VIOLENCE rule table", () => {
  it("has at least 8 rules in each of the five language families, all with the MV_ prefix", () => {
    for (const family of FAMILIES) expect(MV_RULES.filter((r) => r.language === family).length, family).toBeGreaterThanOrEqual(8);
    for (const r of MV_RULES) expect(r.id.startsWith("MV_"), r.id).toBe(true);
  });

  it("has at least 40 positives (every one hits the rule named and a MEDICAL_VIOLENCE hit) and 30 negatives", () => {
    expect(MV_POSITIVES.length).toBeGreaterThanOrEqual(40);
    expect(MV_NEGATIVES.length).toBeGreaterThanOrEqual(30);
    for (const [text, id] of MV_POSITIVES) {
      const hit = detectSafetyWords(text).find((h) => h.rule === id);
      expect(hit?.category, `${text} -> ${id}`).toBe("MEDICAL_VIOLENCE");
    }
  });

  it("the negatives hit no rule at all, and the accepted false positives do hit (documented in docs/safety-words-review.md)", () => {
    for (const text of MV_NEGATIVES) expect(detectSafetyWords(text), text).toEqual([]);
    for (const [text, id] of MV_ACCEPTED_FALSE_POSITIVES) expect(detectSafetyWords(text).some((h) => h.rule === id), text).toBe(true);
  });

  it("the strong terms of the brief of D153 each hit", () => {
    const terms = ["ambulance", "unconscious", "fainted", "not breathing", "cannot breathe", "heart attack", "chest pain", "seizure", "bleeding", "blood", "injured", "badly hurt", "stabbed", "shot", "attacked", "assault", "murder", "killed", "dead body", "someone died", "drowning", "kidnap", "knife", "gun", "weapon", "behosh", "khoon", "chaku", "goli", "maar diya", "ambulance bulao", "jeev gela"];
    for (const term of terms) expect(detectSafetyWords(`please ${term} now`).some((h) => h.category === "MEDICAL_VIOLENCE"), term).toBe(true);
  });

  it("contains no self-harm term (a human decision, listed as a question in the task report)", () => {
    const all = MV_RULES.flatMap((r) => r.terms).join(" ").toLowerCase();
    for (const word of ["suicide", "self harm", "आत्महत्या", "aatmahatya"]) expect(all).not.toContain(word);
  });
});

describe("D153 decisions", () => {
  const decide = (rawText: string, arms: Parameters<typeof decideClassification>[0]["arms"] = []) => decideClassification({ rawText, arms });

  it("a hit is CRITICAL, flagged, escalated, by rule, and needs no triage", () => {
    const d = decide("Killed someone");
    expect(d).toMatchObject({ urgency: "CRITICAL", safetyFlag: true, source: "RULE", escalateToDutyManager: true, needsTriage: false });
    expect(d.reasons).toContain("SAFETY_WORD");
    expect(d.safetyHits[0].category).toBe("MEDICAL_VIOLENCE");
  });

  it("no model answer can lower it, for 2,000 seeded inputs built from the positives", () => {
    const model = { arm: "DIRECT" as const, categories: [{ label: "OTHER" as const, probability: 1 }], urgencies: [{ label: "LOW" as const, probability: 1 }] };
    for (let i = 0; i < 2000; i++) {
      const [text] = MV_POSITIVES[(i * 7919) % MV_POSITIVES.length];
      const decorated = i % 3 === 0 ? text.toUpperCase() : i % 3 === 1 ? `  ${text}  ` : `hello ${text} thanks`;
      const d = decide(decorated, [model, model]);
      expect(d.urgency).toBe("CRITICAL");
      expect(d.safetyFlag).toBe(true);
      expect(d.escalateToDutyManager).toBe(true);
    }
  });
});
