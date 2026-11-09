import { type ArmResult, decideClassification } from "../decision";
import { wilson } from "../safety-benchmark/wilson";
import { urgencyRank } from "../taxonomy";
import { type BenchmarkItem, LANGUAGE_GROUPS, type LanguageGroup } from "./dataset";
import { type ItemResult, type Proportion, productionPolicy } from "./evaluate";

/**
 * MEASUREMENT ONLY (D200). The model's probability for HIGH, read as the answer to "does this complaint need action today" (truth: the dataset's urgency is HIGH or it is
 * not). Nothing here is used by production: no threshold in this file reaches the decision code.
 */

/** The decision thresholds on P(HIGH): 0.10, 0.15, ... 0.60. Built from whole hundredths so that each value is the same number as its written form. */
export const THRESHOLDS: readonly number[] = Array.from({ length: 11 }, (_, i) => (10 + 5 * i) / 100);

/** The recall that the leave-one-group-out selection asks for. */
export const RECALL_TARGET = 0.9;

export type Scored = { item: BenchmarkItem; pHigh: number; productionHigh: boolean };
export type Rule = { kind: "production" } | { kind: "threshold"; at: number };
export type Subset = "all" | "non-hard" | "hard";
export type Scope = "ALL" | LanguageGroup;

const proportion = (k: number, n: number): Proportion => ({ ...wilson(k, n), k, n });
const byId = (a: Scored, b: Scored): number => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0);

/**
 * The items that have a usable answer, each with P(HIGH) and what production stores for it: the production decision function with the production policy and the one
 * DIRECT arm (argmax with the 0.60 acceptance rule, the LOW floor and the urgent-word rule), stored HIGH when its urgency is HIGH or above. An item whose result is a
 * failure has no distribution, so it is left out of every row; `noAnswer` counts them.
 */
export function scoreItems(input: { items: readonly BenchmarkItem[]; results: readonly ItemResult[] }): { scored: Scored[]; noAnswer: number } {
  const results = new Map(input.results.map((r) => [r.id, r]));
  const scored: Scored[] = [];
  let noAnswer = 0;
  for (const item of input.items) {
    const result = results.get(item.id);
    if (result === undefined) continue;
    if (result.categories === null || result.urgencies === null) {
      noAnswer += 1;
      continue;
    }
    const arm: ArmResult = { arm: "DIRECT", categories: result.categories, urgencies: result.urgencies };
    const decision = decideClassification({ rawText: item.text, arms: [arm], policy: productionPolicy });
    scored.push({ item, pHigh: result.urgencies.find((u) => u.label === "HIGH")?.probability ?? 0, productionHigh: urgencyRank(decision.urgency) >= urgencyRank("HIGH") });
  }
  return { scored, noAnswer };
}

/** Whether a rule stores the item as HIGH. A threshold stores it when P(HIGH) is AT LEAST the threshold (a tie is stored). */
export const storesHigh = (s: Scored, rule: Rule): boolean => (rule.kind === "production" ? s.productionHigh : s.pHigh >= rule.at);

export function slice(scored: readonly Scored[], scope: Scope, subset: Subset): Scored[] {
  return scored.filter((s) => (scope === "ALL" || s.item.languageGroup === scope) && (subset === "all" || (subset === "hard") === s.item.hard));
}

export type DetectorMetrics = {
  /** Of the true HIGH items, the share stored HIGH. */
  recall: Proportion;
  /** Of the items stored HIGH, the share that are true HIGH. */
  precision: Proportion;
  /** Of the true NORMAL or LOW items, the share stored HIGH. */
  overRated: Proportion;
  /** The true LOW items stored HIGH, and the number of true LOW items. */
  lowStoredHigh: number;
  trueLow: number;
  /** The true HIGH items that were not stored HIGH, in id order. */
  missed: Scored[];
};

export function measure(scored: readonly Scored[], rule: Rule): DetectorMetrics {
  const stored = scored.filter((s) => storesHigh(s, rule));
  const trueHigh = scored.filter((s) => s.item.urgency === "HIGH");
  const notHigh = scored.filter((s) => s.item.urgency !== "HIGH");
  const hits = trueHigh.filter((s) => storesHigh(s, rule));
  return {
    recall: proportion(hits.length, trueHigh.length),
    precision: proportion(stored.filter((s) => s.item.urgency === "HIGH").length, stored.length),
    overRated: proportion(notHigh.filter((s) => storesHigh(s, rule)).length, notHigh.length),
    lowStoredHigh: scored.filter((s) => s.item.urgency === "LOW" && storesHigh(s, rule)).length,
    trueLow: scored.filter((s) => s.item.urgency === "LOW").length,
    missed: trueHigh.filter((s) => !storesHigh(s, rule)).sort(byId),
  };
}

/**
 * The threshold chosen on `train`: the LARGEST one whose recall of true HIGH is at least 0.90 (compared on the counts, never on a rounded rate); when none reaches it
 * (or there is no true HIGH item at all), the one with the highest recall, and the largest of those that tie.
 */
export function chooseThreshold(train: readonly Scored[], thresholds: readonly number[] = THRESHOLDS): number {
  let reaching: number | null = null;
  let best: { at: number; rate: number } | null = null;
  for (const at of [...thresholds].sort((a, b) => a - b)) {
    const { k, n } = measure(train, { kind: "threshold", at }).recall;
    if (n > 0 && k * 10 >= n * 9) reaching = at;
    const rate = n === 0 ? 0 : k / n;
    if (best === null || rate >= best.rate) best = { at, rate };
  }
  if (reaching !== null) return reaching;
  if (best === null) throw new Error("no thresholds to choose from");
  return best.at;
}

export type Fold = { heldOut: LanguageGroup; threshold: number; recall: Proportion; overRated: Proportion; lowStoredHigh: number; trueLow: number };
export type LeaveOneGroupOut = { folds: Fold[]; spread: { min: number; max: number; range: number }; pooledRecall: Proportion; pooledOverRated: Proportion };

/**
 * Leave-one-group-out: for each language group, the threshold is chosen on the other groups (all their items, hard and not) and applied to the held-out group. The
 * selection reads the same 200 items the held-out numbers come from, so the held-out numbers are optimistic.
 */
export function leaveOneGroupOut(scored: readonly Scored[], groups: readonly LanguageGroup[] = LANGUAGE_GROUPS): LeaveOneGroupOut {
  const folds = groups.map((heldOut): Fold => {
    const threshold = chooseThreshold(scored.filter((s) => s.item.languageGroup !== heldOut));
    const m = measure(scored.filter((s) => s.item.languageGroup === heldOut), { kind: "threshold", at: threshold });
    return { heldOut, threshold, recall: m.recall, overRated: m.overRated, lowStoredHigh: m.lowStoredHigh, trueLow: m.trueLow };
  });
  const chosen = folds.map((f) => f.threshold);
  const min = Math.min(...chosen);
  const max = Math.max(...chosen);
  const sum = (pick: (f: Fold) => Proportion, part: "k" | "n"): number => folds.reduce((total, f) => total + pick(f)[part], 0);
  return {
    folds,
    spread: { min, max, range: Math.round((max - min) * 100) / 100 },
    pooledRecall: proportion(sum((f) => f.recall, "k"), sum((f) => f.recall, "n")),
    pooledOverRated: proportion(sum((f) => f.overRated, "k"), sum((f) => f.overRated, "n")),
  };
}

/** The highest threshold at which the item is still stored HIGH, or null when even the lowest threshold misses it. */
export function highestThresholdStoring(s: Scored, thresholds: readonly number[] = THRESHOLDS): number | null {
  const storing = thresholds.filter((at) => storesHigh(s, { kind: "threshold", at }));
  return storing.length === 0 ? null : Math.max(...storing);
}
