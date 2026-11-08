import { CONTEXTS, embed } from "./contexts";
import { operationsFor } from "./operations";
import type { Rng } from "./prng";
import type { BasePhrase, BenchmarkItem, LanguageForm } from "./types";

/** Changes whenever the generator's behaviour changes; a committed set records the version that made it. */
export const GENERATOR_VERSION = "safety-perturb-1";

export type Perturbed = { text: string; operations: readonly string[] };

/**
 * `count` different operations applied one after the other to the safety words (never the context). A no-op step is skipped and the text must end
 * different from the input. Null when the phrase cannot be changed that many ways.
 */
export function perturbPhrase(text: string, form: LanguageForm, count: 1 | 2, rng: Rng): Perturbed | null {
  const operations = operationsFor(form);
  for (let attempt = 0; attempt < 20; attempt++) {
    let current = text;
    const used: string[] = [];
    for (const operation of rng.shuffle(operations)) {
      if (used.length === count) break;
      const changed = operation.apply(current, rng);
      if (changed === null || changed === current) continue;
      current = changed;
      used.push(operation.name);
    }
    if (used.length === count && current !== text) return { text: current, operations: used };
  }
  return null;
}

/** One positive: a language form chosen first (so each form gets a fifth of the items), then one of its base phrases, perturbed, inside a context. */
export function makeItem(phrasesByForm: Readonly<Record<LanguageForm, readonly BasePhrase[]>>, forms: readonly LanguageForm[], count: 1 | 2, rng: Rng): BenchmarkItem {
  for (;;) {
    const form = rng.pick(forms);
    const base = rng.pick(phrasesByForm[form]);
    const perturbed = perturbPhrase(base.text, form, count, rng);
    if (perturbed === null) continue;
    const text = embed(rng.pick(CONTEXTS[form]), perturbed.text);
    return { text, category: base.category, form, base: base.text, ruleId: base.ruleId, operations: perturbed.operations };
  }
}
