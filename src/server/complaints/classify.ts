import { type Decision, decideClassification, defaultClassificationPolicy } from "@/domain/complaints/decision";
import { deidentify } from "@/domain/complaints/deidentify";
import { detectSafetyWords } from "@/domain/complaints/safety";
import { type Classifier, CLASSIFIER_BUDGET_MS, classifyWithin } from "./classifier";

/** The policy of this task: one arm is enough (there is one classifier call, not the benchmark's two arms), everything else is the default. */
export const raisePolicy = { ...defaultClassificationPolicy, allowSingleArm: true } as const;

/**
 * The classification of a new complaint (D9, D73, D118, D119).
 *
 * 1. The safety rules read the RAW text FIRST. A hit never calls the classifier: the decision is CRITICAL by rule, with the category from the keyword
 *    fallback, and the complaint goes straight to the duty manager.
 * 2. Otherwise the DE-IDENTIFIED text (no phone, e-mail, flat code or known name) is sent to the classifier within a hard total budget; a throw, a
 *    timeout or no answer is "no arm". `decideClassification` (T10a) then decides what to do with the answer: an invalid answer (including one that
 *    says CRITICAL), or none, takes the keyword fallback; a valid answer that is low in confidence or disagrees goes to a person.
 * `latencyMs` is the time of the classifier call, 0 when it was not called.
 */
export async function classifyComplaint(input: {
  rawText: string;
  knownNames: readonly string[];
  classifier: Classifier;
  budgetMs?: number;
  clock?: () => number;
}): Promise<{ decision: Decision; latencyMs: number }> {
  const { rawText } = input;
  if (detectSafetyWords(rawText).length > 0) return { decision: decideClassification({ rawText, arms: [] }), latencyMs: 0 };
  const clock = input.clock ?? Date.now;
  const text = deidentify(rawText, { knownNames: input.knownNames }).text;
  const started = clock();
  const answer = await classifyWithin(input.classifier, { text, arm: "DIRECT" }, input.budgetMs ?? CLASSIFIER_BUDGET_MS);
  const latencyMs = Math.max(0, Math.round(clock() - started));
  return { decision: decideClassification({ rawText, arms: [answer], policy: raisePolicy }), latencyMs };
}
