import { CheckIcon, WarningIcon } from "@/components/icons";
import type { GoalKey, GoalRow } from "@/domain/reports/goals";
import { t } from "@/lib/messages";

const goalLabel = (key: GoalKey): string => {
  switch (key) {
    case "onTimeCollection":
      return t("committee.goals.onTimeCollection");
    case "firstReplyWithinSla":
      return t("committee.goals.firstReplyWithinSla");
    case "reopenedMax":
      return t("committee.goals.reopenedMax");
  }
};

/** The target in words: a ceiling for the reopened goal, a floor for the others. */
const targetText = (row: GoalRow): string => (row.key === "reopenedMax" ? t("committee.goals.atMost", { n: row.targetPercent }) : t("committee.goals.atLeast", { n: row.targetPercent }));

/** The result in WORDS with an icon (a check for Met, a warning for Not met): never colour alone. With nothing to measure it says "No data". */
function Result({ row }: { row: GoalRow }) {
  if (row.status === "NO_DATA") return <span>{t("committee.noData")}</span>;
  const met = row.status === "MET";
  return (
    <span className="inline-flex items-center justify-end gap-2 font-semibold">
      {met ? <CheckIcon size={20} /> : <WarningIcon size={20} />}
      {met ? t("committee.goals.met") : t("committee.goals.notMet")}
    </span>
  );
}

/** The committee's targets against the month's actuals: target, actual and Met or Not met. The targets are assumptions from the `committee_goals` setting, and the block says when they are the built-in defaults. */
export function GoalsBlock({ goals }: { goals: { rows: GoalRow[]; source: "SETTING" | "DEFAULT" } }) {
  return (
    <section aria-labelledby="committee-goals" className="flex flex-col gap-3">
      <h2 id="committee-goals" className="text-title font-semibold">
        {t("committee.goals.heading")}
      </h2>
      <table className="w-full text-left text-body">
        <caption className="sr-only">{t("committee.goals.caption")}</caption>
        <thead>
          <tr className="border-b-2 border-ink">
            <th scope="col" className="py-2 pr-4 font-semibold">{t("committee.goals.col.goal")}</th>
            <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("committee.goals.col.target")}</th>
            <th scope="col" className="py-2 pr-4 text-right font-semibold">{t("committee.goals.col.actual")}</th>
            <th scope="col" className="py-2 text-right font-semibold">{t("committee.goals.col.result")}</th>
          </tr>
        </thead>
        <tbody>
          {goals.rows.map((row) => (
            <tr key={row.key} className="border-b border-hairline">
              <th scope="row" className="py-2 pr-4 font-normal">{goalLabel(row.key)}</th>
              <td className="tnum py-2 pr-4 text-right">{targetText(row)}</td>
              <td className="tnum py-2 pr-4 text-right">{row.actualPercent === null ? t("committee.noData") : t("committee.percent", { n: row.actualPercent })}</td>
              <td className="py-2 text-right">
                <Result row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-caption text-ink-2">{goals.source === "DEFAULT" ? t("committee.goals.default") : t("committee.goals.note")}</p>
    </section>
  );
}
