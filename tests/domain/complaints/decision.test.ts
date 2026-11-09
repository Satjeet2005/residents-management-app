import { describe, expect, it } from "vitest";
import { type ArmName, type ArmResult, type ClassificationPolicy, type Decision, DECISION_RULES, REASON_CODES, type ReasonCode, decideClassification, defaultClassificationPolicy } from "@/domain/complaints/decision";
import { detectSafetyWords } from "@/domain/complaints/safety";
import { CATEGORY_CODES, type CategoryCode, MODEL_URGENCIES, type ModelUrgency } from "@/domain/complaints/taxonomy";
import { createPrng } from "@/domain/seed/prng";

/** A well-formed arm: the chosen label has the given probability, the rest share what is left equally. */
function arm(name: ArmName, category: CategoryCode, categoryP: number, urgency: ModelUrgency = "NORMAL", urgencyP = 0.9): ArmResult {
  const others = CATEGORY_CODES.filter((c) => c !== category);
  const otherUrgencies = MODEL_URGENCIES.filter((u) => u !== urgency);
  return {
    arm: name,
    categories: [{ label: category, probability: categoryP }, ...others.map((label) => ({ label, probability: (1 - categoryP) / others.length }))],
    urgencies: [{ label: urgency, probability: urgencyP }, ...otherUrgencies.map((label) => ({ label, probability: (1 - urgencyP) / otherUrgencies.length }))],
  };
}
const two = (category: CategoryCode, p1 = 0.9, p2 = 0.85): ArmResult[] => [arm("NATIVE", category, p1), arm("TRANSLATED", category, p2)];
const relaxed: ClassificationPolicy = { ...defaultClassificationPolicy, requireAgreement: false, allowSingleArm: true };
const single: ClassificationPolicy = { ...defaultClassificationPolicy, allowSingleArm: true };

type Case = { name: string; text: string; arms: (ArmResult | null)[]; policy?: ClassificationPolicy; expect: Partial<Decision>; reasons?: ReasonCode[] };

const bad = (mutate: (a: ArmResult) => unknown): ArmResult => mutate(arm("NATIVE", "PLUMBING", 0.9)) as ArmResult;

const CASES: Case[] = [
  // R1: safety
  { name: "R1 safety word, no arms: CRITICAL by rule, category from the fallback", text: "gas leak in the kitchen", arms: [], expect: { urgency: "CRITICAL", safetyFlag: true, source: "RULE", escalateToDutyManager: true, needsTriage: false, category: "PLUMBING", confidence: null }, reasons: ["SAFETY_WORD", "MODEL_UNAVAILABLE", "FALLBACK_USED"] },
  { name: "R1 safety word with no category anywhere: category null and still no triage", text: "आग", arms: [], expect: { urgency: "CRITICAL", safetyFlag: true, source: "RULE", needsTriage: false, category: null } },
  { name: "R1 safety word and two agreeing arms: the model's category, confidence the lower top", text: "my mother is stuck in the lift", arms: two("LIFT", 0.9, 0.82), expect: { urgency: "CRITICAL", source: "RULE", escalateToDutyManager: true, category: "LIFT", confidence: 0.82 }, reasons: ["SAFETY_WORD"] },
  { name: "R1 a model that says LOW cannot lower a safety hit", text: "fire in tower 3", arms: [arm("DIRECT", "OTHER", 0.95, "LOW", 0.99)], policy: single, expect: { urgency: "CRITICAL", category: "OTHER" } },
  { name: "R1 a model that says CRITICAL is refused and the safety hit still decides", text: "electric shock from the switch", arms: [bad((a) => ({ ...a, urgencies: [{ label: "CRITICAL", probability: 0.9 }, { label: "HIGH", probability: 0.1 }] }))], expect: { urgency: "CRITICAL", source: "RULE", category: "ELECTRICAL" }, reasons: ["SAFETY_WORD", "INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R1 disagreeing arms do not stop a safety escalation", text: "lift stuck between floors", arms: [arm("NATIVE", "LIFT", 0.9), arm("TRANSLATED", "ELECTRICAL", 0.9)], expect: { urgency: "CRITICAL", needsTriage: false, category: "LIFT" }, reasons: ["SAFETY_WORD", "ARMS_DISAGREE", "FALLBACK_USED"] },
  { name: "R1 Hindi", text: "टावर 5 में आग लगी है", arms: [null], expect: { urgency: "CRITICAL", safetyFlag: true, source: "RULE" } },
  { name: "R1 Marathi", text: "आम्ही लिफ्टमध्ये अडकलो आहोत", arms: [null, null], expect: { urgency: "CRITICAL", category: "LIFT" } },
  { name: "R1 Hinglish", text: "gas ka smell aa raha hai", arms: [], expect: { urgency: "CRITICAL", safetyFlag: true } },
  { name: "R1 safety hits are returned", text: "gas leak", arms: [], expect: {} },

  // R2: every kind of invalid arm is treated as no answer
  { name: "R2 NaN probability", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, categories: a.categories.map((c, i) => (i === 0 ? { ...c, probability: Number.NaN } : c)) }))], expect: { source: "FALLBACK", category: "PLUMBING" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 a probability above 1", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, categories: [{ label: "PLUMBING", probability: 1.5 }, { label: "LIFT", probability: -0.5 }] }))], expect: { source: "FALLBACK" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 a negative probability", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, urgencies: [{ label: "HIGH", probability: -0.1 }, { label: "NORMAL", probability: 1.1 }] }))], expect: { source: "FALLBACK" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 probabilities that do not sum to 1", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, categories: [{ label: "PLUMBING", probability: 0.6 }, { label: "LIFT", probability: 0.3 }] }))], expect: { source: "FALLBACK" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 a duplicate label", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, categories: [{ label: "PLUMBING", probability: 0.5 }, { label: "PLUMBING", probability: 0.5 }] }))], expect: { source: "FALLBACK" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 an empty list", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, categories: [] }))], expect: { source: "FALLBACK" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 a label that is not a category", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, categories: [{ label: "GARDEN", probability: 1 }] }))], expect: { source: "FALLBACK" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 CRITICAL as a model urgency, even with a good sum", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, urgencies: [{ label: "CRITICAL", probability: 1 }] }))], expect: { source: "FALLBACK", urgency: "NORMAL" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 not an object", text: "water leak in the bathroom", arms: ["yes" as unknown as ArmResult], expect: { source: "FALLBACK" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 an unknown arm name", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, arm: "MAGIC" }))], expect: { source: "FALLBACK" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 urgencies missing", text: "water leak in the bathroom", arms: [bad((a) => ({ arm: a.arm, categories: a.categories }))], expect: { source: "FALLBACK" }, reasons: ["INVALID_MODEL_OUTPUT", "FALLBACK_USED"] },
  { name: "R2 one invalid and one valid arm: the valid one alone, and one arm alone is not enough by default", text: "water leak in the bathroom", arms: [bad((a) => ({ ...a, categories: [] })), arm("TRANSLATED", "PLUMBING", 0.95)], expect: { needsTriage: true, category: null, source: "NONE" }, reasons: ["INVALID_MODEL_OUTPUT", "SINGLE_ARM_NOT_ALLOWED"] },

  // R3: arms available
  { name: "R3 two agreeing arms above the threshold: the model, confidence the lower top", text: "the garden is overgrown", arms: two("OTHER", 0.91, 0.78), expect: { source: "LLM", category: "OTHER", confidence: 0.78, needsTriage: false, urgency: "NORMAL" }, reasons: [] },
  { name: "R3 arms that disagree go to triage", text: "something near the stairs", arms: [arm("NATIVE", "LIFT", 0.9), arm("TRANSLATED", "PLUMBING", 0.9)], expect: { needsTriage: true, category: null, source: "NONE" }, reasons: ["ARMS_DISAGREE"] },
  { name: "R3 agreement with one arm below the threshold is low confidence", text: "something near the stairs", arms: [arm("NATIVE", "LIFT", 0.95), arm("TRANSLATED", "LIFT", 0.6)], expect: { needsTriage: true, category: null }, reasons: ["LOW_CONFIDENCE"] },
  { name: "R3 exactly the threshold is accepted", text: "something near the stairs", arms: two("LIFT", 0.7, 0.7), expect: { source: "LLM", category: "LIFT", confidence: 0.7 } },
  { name: "R3 a single arm is refused by the default policy", text: "something near the stairs", arms: [arm("DIRECT", "LIFT", 0.99)], expect: { needsTriage: true, category: null }, reasons: ["SINGLE_ARM_NOT_ALLOWED"] },
  { name: "R3 a single arm is accepted when allowed", text: "something near the stairs", arms: [arm("DIRECT", "LIFT", 0.88)], policy: single, expect: { source: "LLM", category: "LIFT", confidence: 0.88 } },
  { name: "R3 a single arm below the threshold is low confidence even when allowed", text: "something near the stairs", arms: [arm("DIRECT", "LIFT", 0.5)], policy: single, expect: { needsTriage: true }, reasons: ["LOW_CONFIDENCE"] },
  { name: "R3 one arm answered and one did not: allowed alone, and the missing answer is noted", text: "something near the stairs", arms: [arm("DIRECT", "LIFT", 0.9), null], policy: single, expect: { source: "LLM", category: "LIFT" }, reasons: ["MODEL_UNAVAILABLE"] },
  { name: "R3 one arm answered and one did not, default policy: triage", text: "something near the stairs", arms: [null, arm("TRANSLATED", "LIFT", 0.9)], expect: { needsTriage: true }, reasons: ["MODEL_UNAVAILABLE", "SINGLE_ARM_NOT_ALLOWED"] },
  { name: "R3 without the agreement requirement the leading arm wins", text: "something near the stairs", arms: [arm("NATIVE", "LIFT", 0.95), arm("TRANSLATED", "PLUMBING", 0.8)], policy: relaxed, expect: { source: "LLM", category: "LIFT", confidence: 0.95 } },
  { name: "R3 without the agreement requirement, all below the threshold is low confidence", text: "something near the stairs", arms: [arm("NATIVE", "LIFT", 0.5), arm("TRANSLATED", "PLUMBING", 0.4)], policy: relaxed, expect: { needsTriage: true }, reasons: ["LOW_CONFIDENCE"] },
  { name: "R3 an agreed model urgency above its threshold is used", text: "something near the stairs", arms: [arm("NATIVE", "LIFT", 0.9, "HIGH", 0.8), arm("TRANSLATED", "LIFT", 0.9, "HIGH", 0.7)], expect: { source: "LLM", urgency: "HIGH" }, reasons: [] },
  { name: "R3 a model urgency below its threshold is NORMAL and uncertain", text: "something near the stairs", arms: [arm("NATIVE", "LIFT", 0.9, "HIGH", 0.5), arm("TRANSLATED", "LIFT", 0.9, "HIGH", 0.5)], expect: { urgency: "NORMAL" }, reasons: ["URGENCY_UNCERTAIN"] },
  { name: "R3 arms that disagree on urgency are uncertain", text: "something near the stairs", arms: [arm("NATIVE", "LIFT", 0.9, "HIGH", 0.9), arm("TRANSLATED", "LIFT", 0.9, "LOW", 0.9)], expect: { urgency: "NORMAL" }, reasons: ["URGENCY_UNCERTAIN"] },
  { name: "R3 urgent words raise a NORMAL model urgency to HIGH", text: "the lift needs a fix, urgent", arms: two("LIFT"), expect: { source: "LLM", urgency: "HIGH" } },
  { name: "R3 urgent words raise a LOW model urgency to HIGH", text: "the lift needs a fix immediately", arms: [arm("NATIVE", "LIFT", 0.9, "LOW", 0.9), arm("TRANSLATED", "LIFT", 0.9, "LOW", 0.9)], expect: { urgency: "HIGH" } },
  { name: "R3 'not urgent' never lowers a HIGH model urgency", text: "the lift needs a fix, not urgent", arms: [arm("NATIVE", "LIFT", 0.9, "HIGH", 0.9), arm("TRANSLATED", "LIFT", 0.9, "HIGH", 0.9)], expect: { urgency: "HIGH" } },
  { name: "R3 a refusal with urgent words keeps the HIGH urgency", text: "please come at once", arms: [arm("NATIVE", "LIFT", 0.9), arm("TRANSLATED", "PLUMBING", 0.9)], expect: { needsTriage: true, urgency: "HIGH" } },
  { name: "R3 a tie inside an arm goes to the earlier category, whatever order the arm lists them in", text: "something near the stairs", arms: [{ arm: "DIRECT", categories: [{ label: "OTHER", probability: 0.5 }, { label: "PLUMBING", probability: 0.5 }], urgencies: [{ label: "NORMAL", probability: 1 }] }], policy: { ...single, minCategoryProbability: 0.5 }, expect: { category: "PLUMBING" } },

  // R4: no valid arm
  { name: "R4 no arms: the fallback category", text: "water leak in the bathroom", arms: [], expect: { source: "FALLBACK", category: "PLUMBING", confidence: null, needsTriage: false }, reasons: ["MODEL_UNAVAILABLE", "FALLBACK_USED"] },
  { name: "R4 every arm null", text: "garbage not collected", arms: [null, null, null], expect: { source: "FALLBACK", category: "HOUSEKEEPING" }, reasons: ["MODEL_UNAVAILABLE", "FALLBACK_USED"] },
  { name: "R4 nothing to go on: no classification, triage", text: "something is wrong", arms: [], expect: { source: "NONE", category: null, needsTriage: true, urgency: "NORMAL" }, reasons: ["MODEL_UNAVAILABLE", "NO_CLASSIFICATION"] },
  { name: "R4 the fallback's urgency is used as it is (LOW)", text: "tap leaking, no hurry", arms: [], expect: { source: "FALLBACK", urgency: "LOW" } },
  { name: "R4 the fallback's urgency is used as it is (HIGH)", text: "the lift is slow, asap", arms: [], expect: { source: "FALLBACK", category: "LIFT", urgency: "HIGH" } },
  { name: "R4 urgent words without a category still raise the urgency of a triage", text: "come immediately", arms: [], expect: { needsTriage: true, urgency: "HIGH", source: "NONE" } },
  { name: "R4 a tie in the fallback goes to triage", text: "the lift light is out", arms: [], expect: { needsTriage: true, category: null }, reasons: ["MODEL_UNAVAILABLE", "NO_CLASSIFICATION"] },

  // R5: empty text, odd input, policy
  { name: "R5 an empty text goes to triage", text: "", arms: two("LIFT"), expect: { needsTriage: true, category: null, source: "NONE", urgency: "NORMAL" }, reasons: ["EMPTY_TEXT"] },
  { name: "R5 whitespace and zero-width characters only", text: " \n​\t ", arms: [], expect: { needsTriage: true }, reasons: ["EMPTY_TEXT"] },
  { name: "R5 a bad policy falls back to the defaults, and does not throw", text: "something near the stairs", arms: two("LIFT"), policy: { minCategoryProbability: Number.NaN, minUrgencyProbability: 5, requireAgreement: "yes", allowSingleArm: null } as unknown as ClassificationPolicy, expect: { source: "LLM", category: "LIFT" } },
];

describe("CP5 decideClassification: the rules as a table", () => {
  it("has at least 40 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES)("$name", (c) => {
    const decision = decideClassification({ rawText: c.text, arms: c.arms, policy: c.policy });
    expect(decision).toMatchObject(c.expect);
    if (c.reasons !== undefined) expect(decision.reasons).toEqual(expect.arrayContaining(c.reasons));
    if (c.reasons !== undefined && c.reasons.length === 0) expect(decision.reasons).toEqual([]);
  });

  it("every reason code is produced by at least one case", () => {
    const seen = new Set<ReasonCode>();
    for (const c of CASES) for (const reason of decideClassification({ rawText: c.text, arms: c.arms, policy: c.policy }).reasons) seen.add(reason);
    expect([...REASON_CODES].filter((r) => !seen.has(r))).toEqual([]);
  });

  it("the rules table names R1 to R5 in order, and the reason codes are the ten of the design", () => {
    expect(DECISION_RULES.map((r) => r.id)).toEqual(["R1", "R2", "R3", "R4", "R5"]);
    expect([...REASON_CODES].sort()).toEqual(["ARMS_DISAGREE", "EMPTY_TEXT", "FALLBACK_USED", "INVALID_MODEL_OUTPUT", "LOW_CONFIDENCE", "MODEL_UNAVAILABLE", "NO_CLASSIFICATION", "SAFETY_WORD", "SINGLE_ARM_NOT_ALLOWED", "URGENCY_FLOORED", "URGENCY_UNCERTAIN"]);
  });

  it("the default policy is the assumed one", () => {
    expect(defaultClassificationPolicy).toEqual({ minCategoryProbability: 0.7, minUrgencyProbability: 0.6, requireAgreement: true, allowSingleArm: false });
  });

  it("returns the safety hits with the decision, and none without a hit", () => {
    expect(decideClassification({ rawText: "gas leak", arms: [] }).safetyHits.map((h) => h.category)).toContain("GAS");
    expect(decideClassification({ rawText: "tap leak", arms: [] }).safetyHits).toEqual([]);
  });

  it("reads the ORIGINAL text for safety: the model's input is never consulted", () => {
    const decision = decideClassification({ rawText: "लिफ्ट में फंस गए हैं", arms: [arm("NATIVE", "OTHER", 0.99, "LOW", 0.99), arm("TRANSLATED", "OTHER", 0.99, "LOW", 0.99)] });
    expect(decision).toMatchObject({ urgency: "CRITICAL", source: "RULE", category: "OTHER" });
  });
});

/** An independent check of what a valid arm is (R2), so the property tests do not trust the code they test. */
function isValidArm(value: unknown): boolean {
  const a = value as ArmResult | null;
  if (a === null || typeof a !== "object") return false;
  if (!["DIRECT", "NATIVE", "TRANSLATED"].includes(a.arm)) return false;
  const check = (list: unknown, labels: readonly string[]): boolean => {
    if (!Array.isArray(list) || list.length === 0) return false;
    const seen = new Set<string>();
    let sum = 0;
    for (const entry of list as { label: string; probability: number }[]) {
      if (!labels.includes(entry.label) || seen.has(entry.label)) return false;
      if (!Number.isFinite(entry.probability) || entry.probability < 0 || entry.probability > 1) return false;
      seen.add(entry.label);
      sum += entry.probability;
    }
    return Math.abs(sum - 1) <= 0.001;
  };
  return check(a.categories, CATEGORY_CODES) && check(a.urgencies, MODEL_URGENCIES);
}

const TEXTS = [
  "", " ", "water leak in the bathroom", "the lift is not working", "garbage not collected", "light not working urgent", "tap leaking no hurry", "something is wrong",
  "fire in the basement", "gas leak in kitchen", "stuck in the lift", "electric shock from the wall", "आग लगी है", "लिफ्ट में फंस गए", "गैस की बदबू", "बिजली का झटका",
  "लिफ्टमध्ये अडकलो", "विजेचा धक्का", "aag lagi hai", "lift mein phans gaye", "gas ka smell", "current laga", "नल से पानी टपक रहा है", "कचरा नहीं उठा", "🔥", "\u0000\u0001",
  "parking problem and noise", "the lift light is out", "emergency, come at once", "no fire here",
];

function randomArm(rng: ReturnType<typeof createPrng>): ArmResult | null {
  const roll = rng.int(0, 9);
  if (roll === 0) return null;
  const category = rng.pick(CATEGORY_CODES);
  const good = arm(rng.pick(["DIRECT", "NATIVE", "TRANSLATED"] as ArmName[]), category, rng.pick([0.4, 0.55, 0.7, 0.8, 0.95, 1]), rng.pick(MODEL_URGENCIES), rng.pick([0.4, 0.6, 0.9, 1]));
  switch (roll) {
    case 1:
      return { ...good, categories: good.categories.map((c, i) => (i === 0 ? { ...c, probability: Number.NaN } : c)) };
    case 2:
      return { ...good, urgencies: [{ label: "CRITICAL", probability: 1 }] as unknown as ArmResult["urgencies"] };
    case 3:
      return { ...good, categories: [{ label: category, probability: 0.5 }] };
    case 4:
      return { ...good, categories: [] };
    default:
      return good;
  }
}

describe("CP5 properties over 2,000 seeded random inputs", () => {
  const rng = createPrng(20261109);
  const inputs = Array.from({ length: 2000 }, () => ({
    rawText: rng.pick(TEXTS) + (rng.chance(0.3) ? ` ${rng.pick(TEXTS)}` : ""),
    arms: Array.from({ length: rng.int(0, 3) }, () => randomArm(rng)),
    policy: { minCategoryProbability: rng.pick([0.5, 0.7, 0.9]), minUrgencyProbability: rng.pick([0.5, 0.6, 0.9]), requireAgreement: rng.chance(0.5), allowSingleArm: rng.chance(0.5) } as ClassificationPolicy,
  }));
  const results = inputs.map((input) => ({ input, decision: decideClassification(input) }));

  it("a safety hit ALWAYS gives CRITICAL, source RULE, escalated, safety flagged and no triage", () => {
    let hits = 0;
    for (const { input, decision } of results) {
      if (detectSafetyWords(input.rawText).length === 0) continue;
      hits += 1;
      expect(decision).toMatchObject({ urgency: "CRITICAL", source: "RULE", escalateToDutyManager: true, safetyFlag: true, needsTriage: false });
      expect(decision.reasons).toContain("SAFETY_WORD");
    }
    expect(hits).toBeGreaterThan(300);
  });

  it("a non-safety result is NEVER CRITICAL, never source RULE and never escalated", () => {
    for (const { input, decision } of results) {
      if (detectSafetyWords(input.rawText).length > 0) continue;
      expect(decision.urgency).not.toBe("CRITICAL");
      expect(decision.source).not.toBe("RULE");
      expect(decision.escalateToDutyManager).toBe(false);
      expect(decision.safetyFlag).toBe(false);
      expect(decision.safetyHits).toEqual([]);
    }
  });

  it("an invalid arm is never accepted: a model result needs a valid arm, and with only invalid arms the source is never LLM", () => {
    for (const { input, decision } of results) {
      const valid = input.arms.filter(isValidArm);
      if (decision.source === "LLM") expect(valid.length).toBeGreaterThan(0);
      if (valid.length === 0) expect(decision.source).not.toBe("LLM");
      if (decision.source === "LLM") expect(decision.confidence).toBeGreaterThanOrEqual(input.policy.minCategoryProbability);
    }
  });

  it("needsTriage is true whenever the category is null and there is no safety flag", () => {
    for (const { decision } of results) if (decision.category === null && !decision.safetyFlag) expect(decision.needsTriage).toBe(true);
  });

  it("a model result without safety never comes with a null category, and a fallback result has no confidence", () => {
    for (const { decision } of results) {
      if (decision.source === "LLM") expect(decision.category).not.toBeNull();
      if (decision.source === "FALLBACK") expect(decision.confidence).toBeNull();
      if (decision.source === "NONE") expect(decision.category).toBeNull();
    }
  });

  it("the output is deterministic", () => {
    for (const { input, decision } of results.slice(0, 500)) expect(decideClassification(input)).toEqual(decision);
  });

  it("when agreement is required and valid arms disagree on the category, the model is not used", () => {
    let seen = 0;
    for (const { input, decision } of results) {
      const valid = input.arms.filter(isValidArm) as ArmResult[];
      if (!input.policy.requireAgreement || valid.length < 2 || decision.reasons.includes("EMPTY_TEXT")) continue;
      const tops = valid.map((a) => [...a.categories].sort((x, y) => y.probability - x.probability)[0].label);
      if (new Set(tops).size === 1) continue;
      seen += 1;
      expect(decision.source).not.toBe("LLM");
      if (!decision.safetyFlag) expect(decision.reasons).toContain("ARMS_DISAGREE");
    }
    expect(seen).toBeGreaterThan(20);
  });

  it("when agreement is required, an accepted model result needs every valid arm to agree and to reach the threshold", () => {
    for (const { input, decision } of results) {
      if (decision.source !== "LLM" || !input.policy.requireAgreement) continue;
      const valid = input.arms.filter(isValidArm) as ArmResult[];
      if (valid.length < 2) continue;
      for (const a of valid) {
        const best = [...a.categories].sort((x, y) => y.probability - x.probability)[0];
        expect(best.label).toBe(decision.category);
        expect(best.probability).toBeGreaterThanOrEqual(input.policy.minCategoryProbability);
      }
    }
  });
});

describe("CP5 never throws", () => {
  it.each([
    ["undefined input", undefined],
    ["null arms", { rawText: "x", arms: null }],
    ["arms with undefined", { rawText: "x", arms: [undefined] }],
    ["a number as text", { rawText: 5, arms: [] }],
    ["arms with garbage", { rawText: "water leak", arms: [5, "x", {}, { arm: "DIRECT", categories: 3 }, { arm: "DIRECT", categories: [null], urgencies: [null] }] }],
    ["a throwing getter in an arm", { rawText: "water leak", arms: [{ arm: "DIRECT", get categories() { throw new Error("boom"); }, urgencies: [] }] }],
  ])("%s", (_label, input) => {
    expect(() => decideClassification(input as never)).not.toThrow();
    const decision = decideClassification(input as never);
    expect(decision.urgency).not.toBe("CRITICAL");
  });

  it("a throwing arm beside a safety word still escalates", () => {
    const decision = decideClassification({ rawText: "fire", arms: [{ arm: "DIRECT", get categories() { throw new Error("boom"); }, urgencies: [] } as unknown as ArmResult] });
    expect(decision).toMatchObject({ urgency: "CRITICAL", source: "RULE" });
  });
});

describe("CP9 the urgency floor (D199)", () => {
  const decide = (urgency: ModelUrgency, urgencyP = 0.95, rawText = "the corridor paint is peeling") => decideClassification({ rawText, arms: [arm("DIRECT", "OTHER", 0.95, urgency, urgencyP)], policy: single });

  it("a model LOW with high confidence is stored as NORMAL, with the reason and the model's own answer", () => {
    const decision = decide("LOW");
    expect(decision).toMatchObject({ source: "LLM", urgency: "NORMAL", floorFrom: "LOW" });
    expect(decision.reasons).toContain("URGENCY_FLOORED");
  });

  it("a model NORMAL or HIGH is unchanged and carries no floor reason", () => {
    for (const urgency of ["NORMAL", "HIGH"] as const) {
      const decision = decide(urgency);
      expect(decision.urgency).toBe(urgency);
      expect(decision.reasons).not.toContain("URGENCY_FLOORED");
      expect(decision.floorFrom).toBeUndefined();
    }
  });

  it("an uncertain urgency stays NORMAL for the old reason, not the floor", () => {
    const decision = decide("LOW", 0.5);
    expect(decision.urgency).toBe("NORMAL");
    expect(decision.reasons).toContain("URGENCY_UNCERTAIN");
    expect(decision.reasons).not.toContain("URGENCY_FLOORED");
  });

  it("the floor never applies to the keyword fallback or the rules path", () => {
    const fallback = decideClassification({ rawText: "the lift button does not work", arms: [] });
    expect(fallback).toMatchObject({ source: "FALLBACK" });
    expect(fallback.reasons).not.toContain("URGENCY_FLOORED");
    const rule = decideClassification({ rawText: "fire in tower 3", arms: [arm("DIRECT", "OTHER", 0.95, "LOW", 0.99)], policy: single });
    expect(rule).toMatchObject({ source: "RULE", urgency: "CRITICAL" });
    expect(rule.reasons).not.toContain("URGENCY_FLOORED");
  });

  it("an urgent word still raises a floored LOW to HIGH, and no CRITICAL can result from a model", () => {
    expect(decide("LOW", 0.95, "the water tank is overflowing and it is urgent").urgency).not.toBe("LOW");
    for (const urgency of MODEL_URGENCIES) expect(decide(urgency).urgency).not.toBe("CRITICAL");
  });
});

describe("CP10 the urgency floor as a property (D199)", () => {
  it("over 2,000 seeded random model answers: a model decision is never LOW and never CRITICAL, and the floor never changes the category", () => {
    const rng = createPrng(199);
    let floored = 0;
    for (let i = 0; i < 2000; i += 1) {
      const category = rng.pick(CATEGORY_CODES);
      const urgency = rng.pick(MODEL_URGENCIES);
      const categoryP = 0.3 + 0.7 * rng.next();
      const urgencyP = 0.34 + 0.66 * rng.next();
      const model = arm("DIRECT", category, categoryP, urgency, urgencyP);
      const text = rng.pick(["the corridor paint is peeling", "the tap drips", "बाल्कनी का रंग उखड़ गया है", "parking sticker request"]);
      const decision = decideClassification({ rawText: text, arms: [model], policy: single });
      const neutral = decideClassification({ rawText: text, arms: [arm("DIRECT", category, categoryP, "NORMAL", 0.9)], policy: single });
      if (decision.source === "LLM") {
        expect(decision.urgency).not.toBe("LOW");
        expect(decision.urgency).not.toBe("CRITICAL");
        expect(decision.category).toBe(neutral.category);
        if (decision.reasons.includes("URGENCY_FLOORED")) floored += 1;
      }
    }
    expect(floored).toBeGreaterThan(50);
  });
});
