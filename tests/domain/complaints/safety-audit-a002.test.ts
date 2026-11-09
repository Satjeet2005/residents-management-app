import { describe, expect, it } from "vitest";
import { decideClassification } from "@/domain/complaints/decision";
import { SAFETY_RULES, detectSafetyWords } from "@/domain/complaints/safety";
import { buildBase } from "@/domain/complaints/safety-benchmark/base";

/** A-002: six phrases for a stuck lift that did not escalate before the audit. */
const PHRASES = [
  "लिफ्ट अडकली",
  "लिफ्ट अडकली आहे",
  "लिफ्ट अडकल्यामुळे लोक आत आहेत",
  "lift mein phas gaye",
  "lift me atak gaya",
  "lift band ho gayi aur log andar fase hain",
] as const;

const AFTER_AUDIT = SAFETY_RULES.filter((r) => r.since === "audit-A-002");

describe("A-002 lift stuck phrases in Marathi and Hinglish", () => {
  it.each(PHRASES)("A-002 %j hits a LIFT_STUCK rule", (text) => {
    expect(detectSafetyWords(text).some((h) => h.category === "LIFT_STUCK")).toBe(true);
  });

  it.each(PHRASES)("A-002 %j is CRITICAL by rule and asks no model", (text) => {
    const decision = decideClassification({ rawText: text, arms: [null, null, null] });
    expect(decision).toMatchObject({ urgency: "CRITICAL", safetyFlag: true, source: "RULE", escalateToDutyManager: true });
  });

  it("A-002 the new terms are in the detector, under rules marked as added after the audit", () => {
    expect(AFTER_AUDIT.length).toBeGreaterThan(0);
    const terms = AFTER_AUDIT.flatMap((r) => r.terms);
    for (const stem of ["लिफ्ट अडकल", "lift mein phas", "lift me phas", "lift me atak", "lift mein atak"]) expect(terms, stem).toContain(stem);
  });

  it("A-002 the frozen benchmark's base list holds none of the new rules or terms", () => {
    const ids = new Set(AFTER_AUDIT.map((r) => r.id));
    const terms = new Set(AFTER_AUDIT.flatMap((r) => r.terms));
    const base = buildBase();
    expect(base.phrases.filter((p) => ids.has(p.ruleId))).toEqual([]);
    expect(base.dropped.filter((p) => ids.has(p.ruleId))).toEqual([]);
    expect(base.phrases.filter((p) => terms.has(p.text) && ids.has(p.ruleId))).toEqual([]);
  });
});
