import type { ArmResult, ClassifierInput } from "@/domain/complaints/decision";

/**
 * The classifier port (D118). It is the domain's `ClassifierPort` with one addition: an optional AbortSignal, which the caller aborts when the
 * budget is spent, so an adapter can stop its request. An implementation of the domain port (no signal) fits here too. `null` means "no answer".
 * The input text is de-identified. Implementations: `NullClassifier` here, `JevClassifier` (providers/classifier-jev.ts, D140), and a
 * configurable fake in the tests.
 */
export type Classifier = { classify(input: ClassifierInput, options?: ClassifyOptions): Promise<(ArmResult & ClassifierMeta) | null> };

/** `budgetMs` is the total time the caller allows (the signal is aborted when it ends); an adapter with several providers divides it between them. */
export type ClassifyOptions = { signal?: AbortSignal; budgetMs?: number };

/** What an adapter may tell the caller about its answer: which provider answered (its name, never its URL) and how long that call took. */
export type ClassifierMeta = { provider?: string; latencyMs?: number };

/** The classifier when no provider is configured: never answers, so every complaint takes the keyword fallback. */
export const NullClassifier: Classifier = { classify: async () => null };

/** The total time a classification may take, from the call to its answer (D118). */
export const CLASSIFIER_BUDGET_MS = 4000;

/**
 * Asks the classifier within a hard total budget. A throw, a rejection, an answer after the budget, or no answer is `null`. The signal is aborted
 * when the budget is spent so a well-behaved adapter stops, but the answer is not waited for either way.
 */
export async function classifyWithin(classifier: Classifier, input: ClassifierInput, budgetMs: number = CLASSIFIER_BUDGET_MS): Promise<(ArmResult & ClassifierMeta) | null> {
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
      return await classifier.classify(input, { signal: controller.signal, budgetMs });
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
