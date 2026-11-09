import { LANGUAGE_GROUPS } from "./dataset";
import { type Rule, type Scope, type Scored, type Subset, THRESHOLDS, highestThresholdStoring, leaveOneGroupOut, measure, slice, storesHigh } from "./binary-high";
import { cell } from "./report";

const SCOPES: readonly Scope[] = ["ALL", ...LANGUAGE_GROUPS];
const SUBSETS: readonly { subset: Subset; title: string }[] = [
  { subset: "all", title: "All items" },
  { subset: "non-hard", title: "Non-hard items only" },
  { subset: "hard", title: "Hard items only" },
];
const RULES: readonly { rule: Rule; label: string }[] = [{ rule: { kind: "production" }, label: "production" }, ...THRESHOLDS.map((at) => ({ rule: { kind: "threshold", at } as Rule, label: `t = ${at.toFixed(2)}` }))];

const table = (header: string[], rows: string[][]): string => [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const escape = (text: string): string => text.replace(/\|/g, "\\|");

/** The block "Urgency as a same-day detector" of `npm run classifier:benchmark -- --from-fixture`. Deterministic. */
export function formatBinaryHigh(input: { scored: readonly Scored[]; noAnswer: number }): string {
  const { scored } = input;
  const tables = SUBSETS.flatMap(({ subset, title }) => {
    const rows = SCOPES.flatMap((scope) => {
      const part = slice(scored, scope, subset);
      return RULES.map(({ rule, label }) => {
        const m = measure(part, rule);
        return [scope, label, cell(m.recall), cell(m.precision), cell(m.overRated), `${m.lowStoredHigh}/${m.trueLow}`, String(m.missed.length)];
      });
    });
    return [`#### ${title}`, "", table(["Group", "Rule", "Recall of true HIGH (stored HIGH)", "Precision of HIGH", "Over-rated: true NORMAL or LOW stored HIGH", "True LOW stored HIGH", "True HIGH missed"], rows), ""];
  });

  const everMissed = scored.filter((s) => s.item.urgency === "HIGH" && RULES.some(({ rule }) => !storesHigh(s, rule))).sort((a, b) => a.pHigh - b.pHigh || (a.item.id < b.item.id ? -1 : 1));
  const missedRows = everMissed.map((s) => {
    const at = highestThresholdStoring(s);
    return [s.item.id, s.item.languageGroup, s.item.hard ? "hard" : "not hard", escape(s.item.text), s.pHigh.toFixed(3), s.productionHigh ? "stored" : "missed", at === null ? "none" : at.toFixed(2)];
  });

  const logo = leaveOneGroupOut(scored as Scored[]);
  const foldRows = logo.folds.map((f) => [f.heldOut, f.threshold.toFixed(2), cell(f.recall), cell(f.overRated), `${f.lowStoredHigh}/${f.trueLow}`]);
  foldRows.push(["all four held out", "-", cell(logo.pooledRecall), cell(logo.pooledOverRated), "-"]);

  return [
    `### Urgency as a same-day detector (${scored.length} items scored, ${input.noAnswer} without an answer left out)`,
    "",
    "Measurement only (D200): nothing here is used by production. The score is the model's probability for HIGH; the question is \"does this complaint need action today\" (truth: the dataset urgency is HIGH, or it is not). A threshold t stores an item as HIGH when P(HIGH) is at least t. \"production\" is the real decision function (argmax, the 0.60 acceptance rule, the LOW floor, the urgent-word rule), stored HIGH when its urgency is HIGH or above. Over-rated is the share of the true NORMAL or LOW items that are stored HIGH.",
    "",
    ...tables,
    `#### True HIGH items missed by production or by at least one threshold (${everMissed.length})`,
    "",
    table(["Item", "Group", "Hard", "Text", "P(HIGH)", "Production", "Highest t that stores it"], missedRows),
    "",
    "#### Leave-one-group-out threshold choice",
    "",
    `For each group the threshold is the LARGEST one whose recall of true HIGH on the other three groups is at least 0.90 (none reaching it: the highest recall, ties to the larger t), applied to the held-out group. Chosen thresholds: ${logo.folds.map((f) => `${f.heldOut} ${f.threshold.toFixed(2)}`).join(", ")}; spread ${logo.spread.min.toFixed(2)} to ${logo.spread.max.toFixed(2)} (range ${logo.spread.range.toFixed(2)}). The selection used the benchmark itself, so these held-out numbers are optimistic.`,
    "",
    table(["Held-out group", "Chosen t", "Held-out recall of true HIGH", "Held-out over-rated", "True LOW stored HIGH"], foldRows),
  ].join("\n");
}
