import { type ArmResult, defaultClassificationPolicy, decideClassification } from "../decision";
import { classifyByKeywords } from "../fallback";
import { type Interval, wilson } from "../safety-benchmark/wilson";
import { CATEGORY_CODES, type CategoryCode, MODEL_URGENCIES, type ModelUrgency, urgencyRank } from "../taxonomy";
import { type BenchmarkItem, LANGUAGE_GROUPS, type LanguageGroup } from "./dataset";

/** What the runner stored for one item and provider: the validated distributions, or a failure (no distributions). No URL, no key, no text. */
export type ItemResult = {
  id: string;
  status: number | null;
  latencyMs: number;
  categories: { label: CategoryCode; probability: number }[] | null;
  urgencies: { label: ModelUrgency; probability: number }[] | null;
  failure?: string;
};

/** The policy of production (`raisePolicy` in src/server/complaints/classify.ts): the defaults, with one arm allowed. The domain cannot import the server, so it is repeated here and a test pins it. */
export const productionPolicy = { ...defaultClassificationPolicy, allowSingleArm: true } as const;

/** The pre-registered winning rule (D87): accuracy among accepted at least 90% and at least 60% accepted, per language group. */
export const D87_MIN_ACCURACY = 0.9;
export const D87_MIN_ACCEPTED = 0.6;

export type Proportion = Interval & { k: number; n: number };
const proportion = (k: number, n: number): Proportion => ({ ...wilson(k, n), k, n });

export type Verdict = "PASS" | "FAIL";
/** PASS needs BOTH: accuracy among accepted at least 0.90 and accepted share at least 0.60, on the exact rates (never rounded). An empty group fails. */
export const d87Verdict = (correct: number, accepted: number, total: number): Verdict => (accepted > 0 && correct / accepted >= D87_MIN_ACCURACY && accepted / total >= D87_MIN_ACCEPTED ? "PASS" : "FAIL");

export type MetricEval = { accepted: Proportion; accuracyAmongAccepted: Proportion; verdict: Verdict };
export type ProductionEval = { autoClassified: Proportion; accuracyAmongAuto: Proportion; sentToPerson: Proportion; verdict: Verdict };
export type GroupEval = {
  n: number;
  jev: { category: MetricEval; urgency: MetricEval; bothAccepted: Proportion };
  keyword: { category: MetricEval };
  production: ProductionEval;
};
export type Confusion = Record<CategoryCode, Record<CategoryCode, number>>;
export type ConfidentWrong = { id: string; text: string; truth: CategoryCode; predicted: CategoryCode; probability: number };
export type Evaluation = {
  groups: Record<"ALL" | LanguageGroup, GroupEval>;
  confusion: { jev: Confusion; keyword: Confusion; production: Confusion };
  confidentWrong: ConfidentWrong[];
  latency: { p50: number | null; p95: number | null };
  availability: Proportion;
};

const emptyConfusion = (): Confusion => Object.fromEntries(CATEGORY_CODES.map((truth) => [truth, Object.fromEntries(CATEGORY_CODES.map((predicted) => [predicted, 0]))])) as Confusion;

/** Nearest-rank percentile of a list of numbers (null for an empty list). */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

type Row = {
  item: BenchmarkItem;
  jevCategory: CategoryCode | null;
  jevCategoryProbability: number;
  jevUrgency: ModelUrgency | "CRITICAL" | null;
  urgencyAccepted: boolean;
  keywordCategory: CategoryCode | null;
};

function rowOf(item: BenchmarkItem, result: ItemResult): Row {
  const arm: ArmResult | null = result.categories === null || result.urgencies === null ? null : { arm: "DIRECT", categories: result.categories, urgencies: result.urgencies };
  const decision = decideClassification({ rawText: item.text, arms: [arm], policy: productionPolicy });
  const modelUrgency = decision.floorFrom ?? decision.urgency;
  const accepted = decision.source === "LLM";
  const top = result.categories === null ? 0 : Math.max(...result.categories.map((c) => c.probability));
  return {
    item,
    jevCategory: accepted ? decision.category : null,
    jevCategoryProbability: top,
    jevUrgency: accepted ? modelUrgency : null,
    urgencyAccepted: accepted && !decision.reasons.includes("URGENCY_UNCERTAIN"),
    keywordCategory: classifyByKeywords(item.text).category,
  };
}

function groupOf(rows: readonly Row[]): GroupEval {
  const n = rows.length;
  const jevCat = rows.filter((r) => r.jevCategory !== null);
  const jevCatCorrect = jevCat.filter((r) => r.jevCategory === r.item.category).length;
  const jevUrg = rows.filter((r) => r.urgencyAccepted);
  const jevUrgCorrect = jevUrg.filter((r) => r.jevUrgency === r.item.urgency).length;
  const kw = rows.filter((r) => r.keywordCategory !== null);
  const kwCorrect = kw.filter((r) => r.keywordCategory === r.item.category).length;
  const auto = rows.filter((r) => r.jevCategory !== null || r.keywordCategory !== null);
  const autoCorrect = auto.filter((r) => (r.jevCategory ?? r.keywordCategory) === r.item.category).length;
  return {
    n,
    jev: {
      category: { accepted: proportion(jevCat.length, n), accuracyAmongAccepted: proportion(jevCatCorrect, jevCat.length), verdict: d87Verdict(jevCatCorrect, jevCat.length, n) },
      urgency: { accepted: proportion(jevUrg.length, n), accuracyAmongAccepted: proportion(jevUrgCorrect, jevUrg.length), verdict: d87Verdict(jevUrgCorrect, jevUrg.length, n) },
      bothAccepted: proportion(rows.filter((r) => r.jevCategory !== null && r.urgencyAccepted).length, n),
    },
    keyword: { category: { accepted: proportion(kw.length, n), accuracyAmongAccepted: proportion(kwCorrect, kw.length), verdict: d87Verdict(kwCorrect, kw.length, n) } },
    production: { autoClassified: proportion(auto.length, n), accuracyAmongAuto: proportion(autoCorrect, auto.length), sentToPerson: proportion(n - auto.length, n), verdict: d87Verdict(autoCorrect, auto.length, n) },
  };
}

export type UrgencyConfusion = Record<ModelUrgency, Record<ModelUrgency, number>>;
/** The accepted urgencies of a group: the confusion matrix (truth by answer), the errors and how many of them UNDER-rate (true HIGH answered NORMAL or LOW, true NORMAL answered LOW). The model's own answer, before any safety floor. */
export type UrgencyDetail = { confusion: UrgencyConfusion; errors: number; underRated: number };

/** The urgency detail per language group and overall, on the items that have a result. */
export function urgencyDetail(input: { items: readonly BenchmarkItem[]; results: readonly ItemResult[] }): Record<"ALL" | LanguageGroup, UrgencyDetail> {
  const byId = new Map(input.results.map((r) => [r.id, r]));
  const detail = (items: readonly BenchmarkItem[]): UrgencyDetail => {
    const confusion = Object.fromEntries(MODEL_URGENCIES.map((t) => [t, Object.fromEntries(MODEL_URGENCIES.map((a) => [a, 0]))])) as UrgencyConfusion;
    let errors = 0;
    let underRated = 0;
    for (const item of items) {
      const result = byId.get(item.id);
      if (result === undefined) continue;
      const row = rowOf(item, result);
      if (!row.urgencyAccepted || row.jevUrgency === null || row.jevUrgency === "CRITICAL") continue;
      confusion[item.urgency][row.jevUrgency] += 1;
      if (row.jevUrgency !== item.urgency) {
        errors += 1;
        if (urgencyRank(row.jevUrgency) < urgencyRank(item.urgency)) underRated += 1;
      }
    }
    return { confusion, errors, underRated };
  };
  return { ALL: detail(input.items), ...Object.fromEntries(LANGUAGE_GROUPS.map((g) => [g, detail(input.items.filter((i) => i.languageGroup === g))])) } as Record<"ALL" | LanguageGroup, UrgencyDetail>;
}

/**
 * The three arms of the benchmark (D86, D87) on the items that have a result: ARM_JEV (the production acceptance rule: `decideClassification` with one DIRECT arm and
 * the production policy), ARM_KEYWORD (the production keyword fallback) and ARM_PRODUCTION (what a resident gets: Jev if accepted, else the keyword, else a person).
 * Everything is overall and per language group, with Wilson 95 percent intervals and the D87 verdict on the category metric (urgency is reported apart).
 */
export function evaluate(input: { items: readonly BenchmarkItem[]; results: readonly ItemResult[] }): Evaluation {
  const byId = new Map(input.results.map((r) => [r.id, r]));
  const rows = input.items.flatMap((item) => {
    const result = byId.get(item.id);
    return result === undefined ? [] : [rowOf(item, result)];
  });
  const groups = { ALL: groupOf(rows), ...Object.fromEntries(LANGUAGE_GROUPS.map((g) => [g, groupOf(rows.filter((r) => r.item.languageGroup === g))])) } as Evaluation["groups"];
  const confusion = { jev: emptyConfusion(), keyword: emptyConfusion(), production: emptyConfusion() };
  for (const r of rows) {
    if (r.jevCategory !== null) confusion.jev[r.item.category][r.jevCategory] += 1;
    if (r.keywordCategory !== null) confusion.keyword[r.item.category][r.keywordCategory] += 1;
    const production = r.jevCategory ?? r.keywordCategory;
    if (production !== null) confusion.production[r.item.category][production] += 1;
  }
  const confidentWrong = rows
    .filter((r) => r.jevCategory !== null && r.jevCategory !== r.item.category)
    .map((r): ConfidentWrong => ({ id: r.item.id, text: r.item.text, truth: r.item.category, predicted: r.jevCategory as CategoryCode, probability: r.jevCategoryProbability }))
    .sort((a, b) => b.probability - a.probability || (a.id < b.id ? -1 : 1))
    .slice(0, 20);
  const attempts = input.results.filter((r) => byId.has(r.id));
  const successes = attempts.filter((r) => r.categories !== null && r.urgencies !== null);
  return {
    groups,
    confusion,
    confidentWrong,
    latency: { p50: percentile(successes.map((r) => r.latencyMs), 50), p95: percentile(successes.map((r) => r.latencyMs), 95) },
    availability: proportion(successes.length, attempts.length),
  };
}
