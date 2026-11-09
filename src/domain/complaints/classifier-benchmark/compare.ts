import { MODEL_URGENCIES } from "../taxonomy";
import { type BenchmarkItem, LANGUAGE_GROUPS } from "./dataset";
import { type Evaluation, type ItemResult, type UrgencyDetail, evaluate, urgencyDetail } from "./evaluate";
import { cell } from "./report";

type Key = "ALL" | (typeof LANGUAGE_GROUPS)[number];
const KEYS: readonly Key[] = ["ALL", ...LANGUAGE_GROUPS];
const EPSILON = 1e-9;

/** The pre-registered rule for adopting prompt v2 (D197), fixed before the v2 run and never changed after it. */
export const ADOPTION_RULE_TEXT =
  "Adopt v2 only if ALL hold on the items measured: (a) overall urgency accuracy among accepted rises by at least 5 percentage points over v1, OR v2 passes the D87 urgency bar in at least two more language groups than v1; (b) urgency accepted share stays at least 50 percent; (c) category accuracy among accepted falls by no more than 2 percentage points in ANY group and category accepted share by no more than 5 points.";

export type Adoption = { adopt: boolean; a: boolean; b: boolean; c: boolean; urgencyAccuracyChange: number; passingGroups: { v1: number; v2: number }; worstCategoryAccuracyFall: number; worstCategoryAcceptedFall: number };

const rate = (p: { k: number; n: number }): number => (p.n === 0 ? 0 : p.k / p.n);
const passes = (e: Evaluation, g: Key): boolean => e.groups[g].jev.urgency.verdict === "PASS";

/** The pre-registered rule applied to two evaluations of the same items. Rates are exact fractions; a fall is measured in fractions (0.02 is 2 points). */
export function adoptionRule(v1: Evaluation, v2: Evaluation): Adoption {
  const urgencyAccuracyChange = rate(v2.groups.ALL.jev.urgency.accuracyAmongAccepted) - rate(v1.groups.ALL.jev.urgency.accuracyAmongAccepted);
  const passingGroups = { v1: LANGUAGE_GROUPS.filter((g) => passes(v1, g)).length, v2: LANGUAGE_GROUPS.filter((g) => passes(v2, g)).length };
  const fall = (pick: (e: Evaluation, g: Key) => number): number => Math.max(...KEYS.map((g) => pick(v1, g) - pick(v2, g)));
  const worstCategoryAccuracyFall = fall((e, g) => rate(e.groups[g].jev.category.accuracyAmongAccepted));
  const worstCategoryAcceptedFall = fall((e, g) => rate(e.groups[g].jev.category.accepted));
  const a = urgencyAccuracyChange >= 0.05 - EPSILON || passingGroups.v2 - passingGroups.v1 >= 2;
  const b = rate(v2.groups.ALL.jev.urgency.accepted) >= 0.5 - EPSILON;
  const c = worstCategoryAccuracyFall <= 0.02 + EPSILON && worstCategoryAcceptedFall <= 0.05 + EPSILON;
  return { adopt: a && b && c, a, b, c, urgencyAccuracyChange, passingGroups, worstCategoryAccuracyFall, worstCategoryAcceptedFall };
}

const table = (header: string[], rows: string[][]): string => [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
const underShare = (d: UrgencyDetail): string => (d.errors === 0 ? "no errors" : `${pct(d.underRated / d.errors)} (${d.underRated}/${d.errors})`);
const matrix = (d: UrgencyDetail): string => MODEL_URGENCIES.map((t) => `${t}: ${MODEL_URGENCIES.map((a) => d.confusion[t][a]).join("/")}`).join("; ");

/**
 * v1 against v2 on the SAME items (v1 is restricted to the ids v2 completed), per language group: the accepted share and the accuracy among accepted for urgency and
 * category, the D87 verdicts, the urgency confusion (rows are the truth, the numbers are answered HIGH/NORMAL/LOW) and the share of errors that under-rate urgency;
 * then the pre-registered rule with its three clauses. Urgency is the model's own answer, before the safety floor.
 */
export function formatComparison(input: { items: readonly BenchmarkItem[]; v1: readonly ItemResult[]; v2: readonly ItemResult[] }): string {
  const ids = new Set(input.v2.map((r) => r.id));
  const items = input.items.filter((i) => ids.has(i.id));
  const v1Results = input.v1.filter((r) => ids.has(r.id));
  const e1 = evaluate({ items, results: v1Results });
  const e2 = evaluate({ items, results: input.v2 });
  const u1 = urgencyDetail({ items, results: v1Results });
  const u2 = urgencyDetail({ items, results: input.v2 });
  const row = (g: Key, pick: (e: Evaluation) => [string, string, string]): string[] => [g, String(e1.groups[g].n), ...pick(e1), ...pick(e2)];
  const urgency = (e: Evaluation, g: Key): [string, string, string] => [cell(e.groups[g].jev.urgency.accepted), cell(e.groups[g].jev.urgency.accuracyAmongAccepted), e.groups[g].jev.urgency.verdict];
  const category = (e: Evaluation, g: Key): [string, string, string] => [cell(e.groups[g].jev.category.accepted), cell(e.groups[g].jev.category.accuracyAmongAccepted), e.groups[g].jev.category.verdict];
  const header = ["Group", "Items", "v1 accepted", "v1 accuracy among accepted", "v1 D87", "v2 accepted", "v2 accuracy among accepted", "v2 D87"];
  const rule = adoptionRule(e1, e2);
  return [
    `### Prompt v1 against v2 (${e1.groups.ALL.n} items, the same items for both)`,
    "",
    "**Urgency** (the model's own answer, before the safety floor):",
    "",
    table(header, KEYS.map((g) => row(g, (e) => urgency(e, g)))),
    "",
    "**Category:**",
    "",
    table(header, KEYS.map((g) => row(g, (e) => category(e, g)))),
    "",
    "**Urgency confusion** (truth: answers HIGH/NORMAL/LOW) and the share of errors that UNDER-rate urgency (true HIGH answered NORMAL or LOW, true NORMAL answered LOW):",
    "",
    table(["Group", "v1 confusion", "v1 under-rated", "v2 confusion", "v2 under-rated"], KEYS.map((g) => [g, matrix(u1[g]), underShare(u1[g]), matrix(u2[g]), underShare(u2[g])])),
    "",
    `**The pre-registered rule.** ${ADOPTION_RULE_TEXT}`,
    "",
    table(
      ["Clause", "Holds", "Measured"],
      [
        ["(a)", rule.a ? "yes" : "no", `overall urgency accuracy among accepted changed by ${(100 * rule.urgencyAccuracyChange).toFixed(1)} points; groups passing the D87 urgency bar: v1 ${rule.passingGroups.v1}, v2 ${rule.passingGroups.v2}`],
        ["(b)", rule.b ? "yes" : "no", `urgency accepted share of v2: ${pct(e2.groups.ALL.jev.urgency.accepted.rate)}`],
        ["(c)", rule.c ? "yes" : "no", `largest fall in category accuracy among accepted: ${(100 * rule.worstCategoryAccuracyFall).toFixed(1)} points; largest fall in category accepted share: ${(100 * rule.worstCategoryAcceptedFall).toFixed(1)} points`],
      ],
    ),
    "",
    `**Outcome: ${rule.adopt ? "v2 is adopted as the default." : "v2 is NOT adopted; v1 stays the default."}**`,
  ].join("\n");
}
