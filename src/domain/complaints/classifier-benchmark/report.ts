import { CATEGORY_CODES } from "../taxonomy";
import { LANGUAGE_GROUPS } from "./dataset";
import type { Confusion, Evaluation, MetricEval, Proportion } from "./evaluate";

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
/** "87.5% (7/8; 52.9%-97.8%)": the rate, the counts and the 95 percent Wilson interval. */
export const cell = (p: Proportion): string => (p.n === 0 ? "no items" : `${pct(p.rate)} (${p.k}/${p.n}; ${pct(p.lo)}-${pct(p.hi)})`);

const GROUPS = ["ALL", ...LANGUAGE_GROUPS] as const;
const table = (header: string[], rows: string[][]): string => [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const metricTable = (evaluation: Evaluation, pick: (g: Evaluation["groups"]["ALL"]) => MetricEval): string =>
  table(["Group", "Items", "Accepted", "Accuracy among accepted", "D87"], GROUPS.map((g) => [g, String(evaluation.groups[g].n), cell(pick(evaluation.groups[g]).accepted), cell(pick(evaluation.groups[g]).accuracyAmongAccepted), pick(evaluation.groups[g]).verdict]));

const confusionTable = (matrix: Confusion): string => table(["Truth \\ answered", ...CATEGORY_CODES], CATEGORY_CODES.map((truth) => [truth, ...CATEGORY_CODES.map((predicted) => String(matrix[truth][predicted]))]));

/** The numbers of one provider as Markdown. Deterministic: the same evaluation always gives the same text (the docs test compares it with the file). */
export function formatProvider(label: string, evaluation: Evaluation): string {
  const all = evaluation.groups.ALL;
  return [
    `### ${label} (${all.n} items)`,
    "",
    "**Jev, category** (accepted by the production rule, then accuracy among the accepted):",
    "",
    metricTable(evaluation, (g) => g.jev.category),
    "",
    "**Jev, urgency** (reported apart; an urgency under 0.60 is not accepted):",
    "",
    metricTable(evaluation, (g) => g.jev.urgency),
    "",
    "**Keyword baseline, category** (the production fallback):",
    "",
    metricTable(evaluation, (g) => g.keyword.category),
    "",
    "**Production** (Jev if accepted, else the keywords, else a person):",
    "",
    table(["Group", "Items", "Classified automatically", "Accuracy among those", "Sent to a person", "D87"], GROUPS.map((g) => [g, String(evaluation.groups[g].n), cell(evaluation.groups[g].production.autoClassified), cell(evaluation.groups[g].production.accuracyAmongAuto), cell(evaluation.groups[g].production.sentToPerson), evaluation.groups[g].production.verdict])),
    "",
    `Both category and urgency accepted: ${cell(all.jev.bothAccepted)}.`,
    "",
    "**Confusion, Jev** (rows are the truth, columns the answer; accepted answers only):",
    "",
    confusionTable(evaluation.confusion.jev),
    "",
    "**Confusion, keywords:**",
    "",
    confusionTable(evaluation.confusion.keyword),
    "",
    "**Confusion, production:**",
    "",
    confusionTable(evaluation.confusion.production),
    "",
    `**The ${evaluation.confidentWrong.length} most confident wrong answers of Jev** (accepted, and wrong):`,
    "",
    evaluation.confidentWrong.length === 0 ? "None." : table(["Item", "Truth", "Answered", "Probability", "Text"], evaluation.confidentWrong.map((w) => [w.id, w.truth, w.predicted, w.probability.toFixed(2), w.text.replace(/\|/g, "/")])),
    "",
    `Latency of the answers: p50 ${evaluation.latency.p50 ?? "n/a"} ms, p95 ${evaluation.latency.p95 ?? "n/a"} ms. Availability (answers over attempts): ${cell(evaluation.availability)}.`,
  ].join("\n");
}
