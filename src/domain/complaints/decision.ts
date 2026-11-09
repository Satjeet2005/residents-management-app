import { classifyByKeywords } from "./fallback";
import { detectSafetyWords, type SafetyHit } from "./safety";
import { CATEGORY_CODES, type CategoryCode, MODEL_URGENCIES, type ModelUrgency, type Urgency, higherUrgency, isCategoryCode, isModelUrgency } from "./taxonomy";
import { normalizeComplaintText } from "./text";

export type ArmName = "DIRECT" | "NATIVE" | "TRANSLATED";

/** What one way of asking a model answered: a probability for each category and for each model urgency (CRITICAL is never one of them). */
export type ArmResult = {
  arm: ArmName;
  categories: { label: CategoryCode; probability: number }[];
  urgencies: { label: ModelUrgency; probability: number }[];
};

/** Declarations only: an adapter, built later, implements these. `null` means "no answer" (a failure, a timeout, no key). The input text is de-identified. */
export type ClassifierInput = { text: string; arm: ArmName };
export type ClassifierPort = { classify(input: ClassifierInput): Promise<ArmResult | null> };
export type TranslatorPort = { translate(text: string): Promise<string | null> };

/**
 * The thresholds. THESE DEFAULTS ARE ASSUMPTIONS, to be set by the benchmark (docs/complaint-classification.md): 0.70 and 0.60 are a starting guess,
 * and the conservative booleans (agreement required, one arm alone not enough) send more complaints to a person until the benchmark says otherwise.
 */
export type ClassificationPolicy = { minCategoryProbability: number; minUrgencyProbability: number; requireAgreement: boolean; allowSingleArm: boolean };
export const defaultClassificationPolicy: ClassificationPolicy = { minCategoryProbability: 0.7, minUrgencyProbability: 0.6, requireAgreement: true, allowSingleArm: false };

export const REASON_CODES = ["SAFETY_WORD", "INVALID_MODEL_OUTPUT", "ARMS_DISAGREE", "LOW_CONFIDENCE", "URGENCY_UNCERTAIN", "URGENCY_FLOORED", "URGENCY_KEPT_ON_REFUSAL", "MODEL_UNAVAILABLE", "FALLBACK_USED", "NO_CLASSIFICATION", "EMPTY_TEXT", "SINGLE_ARM_NOT_ALLOWED"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type Decision = {
  category: CategoryCode | null;
  urgency: Urgency;
  safetyFlag: boolean;
  source: "RULE" | "LLM" | "FALLBACK" | "NONE";
  /** The lowest top probability among the accepted arms; null when no model result was used. */
  confidence: number | null;
  needsTriage: boolean;
  escalateToDutyManager: boolean;
  reasons: ReasonCode[];
  safetyHits: SafetyHit[];
  /** Set only when the urgency floor raised a model answer of LOW to NORMAL (D199): the model's own answer, kept for the record. */
  floorFrom?: "LOW";
};

/** The rules, in the order they are documented. They are applied as: R2 validates, R3 accepts or refuses the model, R4 falls back, R1 then overrides for safety, R5 holds throughout. */
export const DECISION_RULES = [
  { id: "R1", summary: "Any safety hit: CRITICAL, source RULE, escalate, no triage; the category comes from an accepted model result or the fallback; nothing can lower it." },
  { id: "R2", summary: "Every arm is validated (finite probabilities in [0,1], non-empty unique labels summing to 1, no CRITICAL); an invalid arm is treated as no answer." },
  { id: "R3", summary: "With valid arms: agreement and the thresholds decide; one arm alone only when allowed; confidence is the lowest top probability; urgency never goes below an urgent word; an accepted model urgency of LOW is stored as NORMAL (URGENCY_FLOORED, D199); when the category is refused, an accepted model urgency of HIGH is still stored (URGENCY_KEPT_ON_REFUSAL, D203)." },
  { id: "R4", summary: "With no valid arm: the keyword fallback, else triage." },
  { id: "R5", summary: "Deterministic, never throws; an empty text goes to triage." },
] as const;

const SUM_TOLERANCE = 0.001;

function validDistribution<L extends string>(entries: unknown, isLabel: (label: unknown) => label is L): { label: L; probability: number }[] | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const seen = new Set<string>();
  let sum = 0;
  const out: { label: L; probability: number }[] = [];
  for (const entry of entries as { label?: unknown; probability?: unknown }[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const { label, probability } = entry;
    if (!isLabel(label) || seen.has(label)) return null;
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
    seen.add(label);
    sum += probability;
    out.push({ label, probability });
  }
  return Math.abs(sum - 1) <= SUM_TOLERANCE ? out : null;
}

/** R2: the arm if it is well formed, else null. */
function validateArm(arm: unknown): ArmResult | null {
  if (typeof arm !== "object" || arm === null) return null;
  const candidate = arm as { arm?: unknown; categories?: unknown; urgencies?: unknown };
  if (candidate.arm !== "DIRECT" && candidate.arm !== "NATIVE" && candidate.arm !== "TRANSLATED") return null;
  const categories = validDistribution(candidate.categories, isCategoryCode);
  const urgencies = validDistribution(candidate.urgencies, isModelUrgency);
  return categories === null || urgencies === null ? null : { arm: candidate.arm, categories, urgencies };
}

/** The most likely label; ties go to the earlier label of the taxonomy, so the answer never depends on the order the arm listed them. */
function top<L extends string>(entries: { label: L; probability: number }[], order: readonly string[]): { label: L; probability: number } {
  return entries.reduce((best, entry) => (entry.probability > best.probability || (entry.probability === best.probability && order.indexOf(entry.label) < order.indexOf(best.label)) ? entry : best));
}

function sanitize(policy: ClassificationPolicy): ClassificationPolicy {
  const unit = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback);
  return {
    minCategoryProbability: unit(policy?.minCategoryProbability, defaultClassificationPolicy.minCategoryProbability),
    minUrgencyProbability: unit(policy?.minUrgencyProbability, defaultClassificationPolicy.minUrgencyProbability),
    requireAgreement: typeof policy?.requireAgreement === "boolean" ? policy.requireAgreement : defaultClassificationPolicy.requireAgreement,
    allowSingleArm: typeof policy?.allowSingleArm === "boolean" ? policy.allowSingleArm : defaultClassificationPolicy.allowSingleArm,
  };
}

type Accepted = { category: CategoryCode; confidence: number; urgency: ModelUrgency; urgencyUncertain: boolean };
type Refusal = "ARMS_DISAGREE" | "LOW_CONFIDENCE" | "SINGLE_ARM_NOT_ALLOWED";
type Top = { category: { label: CategoryCode; probability: number }; urgency: { label: ModelUrgency; probability: number } };

/** The model urgency of the arms in `used`: their label when they all say it with at least the urgency threshold, else NORMAL (uncertain). */
function acceptUrgency(used: Top[], policy: ClassificationPolicy): { urgency: ModelUrgency; uncertain: boolean } {
  const urgencies = used.map((t) => t.urgency);
  const certain = urgencies.every((u) => u.label === urgencies[0].label) && urgencies.every((u) => u.probability >= policy.minUrgencyProbability);
  return { urgency: certain ? urgencies[0].label : "NORMAL", uncertain: !certain };
}

/** D203: a refused category does not discard a confident HIGH. Only HIGH, only when the existing urgency rule accepts it; every other urgency of a refused answer is dropped. */
const keepsHigh = (tops: Top[], policy: ClassificationPolicy): boolean => acceptUrgency(tops, policy).urgency === "HIGH";

/** R3: accept or refuse the valid arms. */
function acceptArms(valid: ArmResult[], policy: ClassificationPolicy): { accepted: Accepted } | { refusal: Refusal; keptHigh: boolean } {
  const tops = valid.map((arm) => ({ category: top(arm.categories, CATEGORY_CODES), urgency: top(arm.urgencies, MODEL_URGENCIES) }));
  let used: Top[];

  if (valid.length === 1) {
    if (!policy.allowSingleArm) return { refusal: "SINGLE_ARM_NOT_ALLOWED", keptHigh: false };
    if (tops[0].category.probability < policy.minCategoryProbability) return { refusal: "LOW_CONFIDENCE", keptHigh: keepsHigh(tops, policy) };
    used = tops;
  } else if (policy.requireAgreement) {
    if (!tops.every((t) => t.category.label === tops[0].category.label)) return { refusal: "ARMS_DISAGREE", keptHigh: keepsHigh(tops, policy) };
    if (!tops.every((t) => t.category.probability >= policy.minCategoryProbability)) return { refusal: "LOW_CONFIDENCE", keptHigh: keepsHigh(tops, policy) };
    used = tops;
  } else {
    const leader = tops.reduce((best, t) => (t.category.probability > best.category.probability ? t : best));
    used = tops.filter((t) => t.category.label === leader.category.label && t.category.probability >= policy.minCategoryProbability);
    if (used.length === 0) return { refusal: "LOW_CONFIDENCE", keptHigh: keepsHigh(tops, policy) };
  }

  const { urgency, uncertain } = acceptUrgency(used, policy);
  return { accepted: { category: used[0].category.label, confidence: Math.min(...used.map((t) => t.category.probability)), urgency, urgencyUncertain: uncertain } };
}

const unique = <T>(items: T[]): T[] => [...new Set(items)];
const ORDER: readonly ReasonCode[] = REASON_CODES;
const ordered = (reasons: ReasonCode[]): ReasonCode[] => unique(reasons).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

/**
 * The classification of one complaint (D9, D73, D86). Pure and deterministic, it never throws.
 *
 * SAFETY FIRST: the safety rules read the ORIGINAL text before anything else. A hit makes the answer CRITICAL, source RULE, escalated to the duty
 * manager, and nothing a model or the fallback says can lower it; a model can never produce CRITICAL (an arm that says so is refused).
 * Then the arms are validated (R2) and accepted or refused (R3); with no valid arm the keyword fallback answers (R4), else the complaint goes to a person.
 * An arm is `null` when its adapter gave no answer.
 */
export function decideClassification(input: { rawText: string; arms: readonly (ArmResult | null)[]; policy?: ClassificationPolicy }): Decision {
  const rawText = typeof input?.rawText === "string" ? input.rawText : "";
  const policy = sanitize(input?.policy ?? defaultClassificationPolicy);
  const safetyHits = detectSafetyWords(rawText);
  const safetyFlag = safetyHits.length > 0;
  const text = normalizeComplaintText(rawText);

  if (text === "" && !safetyFlag) {
    return { category: null, urgency: "NORMAL", safetyFlag: false, source: "NONE", confidence: null, needsTriage: true, escalateToDutyManager: false, reasons: ["EMPTY_TEXT"], safetyHits: [] };
  }

  const reasons: ReasonCode[] = [];
  if (safetyFlag) reasons.push("SAFETY_WORD");

  const armList = Array.isArray(input?.arms) ? input.arms : [];
  const valid: ArmResult[] = [];
  if (armList.length === 0 || armList.some((arm) => arm === null || arm === undefined)) reasons.push("MODEL_UNAVAILABLE");
  for (const arm of armList) {
    if (arm === null || arm === undefined) continue;
    let checked: ArmResult | null = null;
    try {
      checked = validateArm(arm);
    } catch {
      checked = null;
    }
    if (checked === null) reasons.push("INVALID_MODEL_OUTPUT");
    else valid.push(checked);
  }

  const keywords = classifyByKeywords(text);
  const urgentWords = keywords.urgency === "HIGH";

  let category: CategoryCode | null = null;
  let urgency: Urgency = "NORMAL";
  let source: Decision["source"] = "NONE";
  let confidence: number | null = null;
  let needsTriage = false;
  let floorFrom: "LOW" | undefined;

  if (valid.length > 0) {
    const outcome = acceptArms(valid, policy);
    if ("accepted" in outcome) {
      category = outcome.accepted.category;
      confidence = outcome.accepted.confidence;
      source = "LLM";
      let modelUrgency: ModelUrgency = outcome.accepted.urgency;
      if (modelUrgency === "LOW") {
        modelUrgency = "NORMAL";
        floorFrom = "LOW";
        reasons.push("URGENCY_FLOORED");
      }
      urgency = urgentWords ? higherUrgency(modelUrgency, "HIGH") : modelUrgency;
      if (outcome.accepted.urgencyUncertain) reasons.push("URGENCY_UNCERTAIN");
    } else {
      reasons.push(outcome.refusal);
      needsTriage = true;
      urgency = urgentWords || outcome.keptHigh ? "HIGH" : "NORMAL";
      if (outcome.keptHigh) reasons.push("URGENCY_KEPT_ON_REFUSAL");
    }
  } else if (keywords.category !== null) {
    category = keywords.category;
    source = "FALLBACK";
    urgency = keywords.urgency;
    reasons.push("FALLBACK_USED");
  } else {
    needsTriage = true;
    urgency = keywords.urgency;
    reasons.push("NO_CLASSIFICATION");
  }

  if (safetyFlag) {
    if (category === null && keywords.category !== null) {
      category = keywords.category;
      reasons.push("FALLBACK_USED");
    }
    return { category, urgency: "CRITICAL", safetyFlag: true, source: "RULE", confidence, needsTriage: false, escalateToDutyManager: true, reasons: ordered(reasons.filter((r) => r !== "URGENCY_FLOORED" && r !== "URGENCY_KEPT_ON_REFUSAL")), safetyHits };
  }
  return { category, urgency, safetyFlag: false, source, confidence, needsTriage: needsTriage || category === null, escalateToDutyManager: false, reasons: ordered(reasons), safetyHits: [], ...(floorFrom === undefined ? {} : { floorFrom }) };
}
