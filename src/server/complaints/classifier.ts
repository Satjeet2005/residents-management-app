import type { ArmResult, ClassifierInput } from "@/domain/complaints/decision";

/**
 * The classifier port (D118). It is the domain's `ClassifierPort` with one addition: an optional AbortSignal, which the caller aborts when the
 * budget is spent, so an adapter can stop its request. An implementation of the domain port (no signal) fits here too. `null` means "no answer".
 * The input text is de-identified. Provider adapters are a later task; there are two implementations today: `NullClassifier` here, and a
 * configurable fake in the tests.
 */
export type Classifier = { classify(input: ClassifierInput, options?: { signal?: AbortSignal }): Promise<ArmResult | null> };

/** Production until a provider lands: never answers, so every complaint takes the keyword fallback. */
export const NullClassifier: Classifier = { classify: async () => null };

/** The total time a classification may take, from the call to its answer (D118). */
export const CLASSIFIER_BUDGET_MS = 4000;

/**
 * Asks the classifier within a hard total budget. A throw, a rejection, an answer after the budget, or no answer is `null`. The signal is aborted
 * when the budget is spent so a well-behaved adapter stops, but the answer is not waited for either way.
 */
export async function classifyWithin(classifier: Classifier, input: ClassifierInput, budgetMs: number = CLASSIFIER_BUDGET_MS): Promise<ArmResult | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, budgetMs);
  });
  const asked = (async () => {
    try {
      return await classifier.classify(input, { signal: controller.signal });
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([asked, expired]);
  } finally {
    clearTimeout(timer);
  }
}
