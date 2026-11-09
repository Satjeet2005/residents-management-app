import { cx } from "@/components/ui/cx";
import { GoalBar } from "@/components/charts/goal-bar";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/icons";
import { t } from "@/lib/messages";
import { monthName } from "@/lib/format-date";
import { dateWords } from "@/lib/reports/period";
import { type GoalMark, type PreviousLine, type TrendPoint, goalBarLabel } from "@/lib/reports/cards";
import { collectedBarLabel } from "@/lib/reports/visuals";
import type { CommitteeReport } from "@/server/reports/report-data";
import { GoalTag } from "./goal-mark";

/**
 * `phonePeriod`: the period line is shown on a phone only when the title does not already say it (the title of three cards names the month); it is always in the HTML.
 * `note` sits beside the large value on one baseline (the goal words of a goal card), so the goal does not need a line of its own.
 */
function Card({ label, period, phonePeriod, tag, value, note, children }: { label: string; period: string; phonePeriod: boolean; tag?: React.ReactNode; value: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-control border border-hairline p-3 md:p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-body font-semibold">{label}</h2>
        {tag}
      </div>
      <p className={cx("text-caption text-ink-2", !phonePeriod && "hidden md:block")}>{period}</p>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="tnum text-hero font-semibold">{value}</p>
        {note}
      </div>
      {children}
    </li>
  );
}

/** The small tick drawn in the goal bar, repeated before the goal words so that the line works as the key of the bar. */
const TickGlyph = () => <span aria-hidden="true" className="mr-2 inline-block h-4 w-0.5 bg-ink align-middle" />;

/** "<tick> Goal 90% · 20 points short": the one place the goal is written on a card. */
const GoalLine = ({ mark }: { mark: GoalMark }) => (
  <p className="tnum text-caption text-ink-2">
    <TickGlyph />
    {mark.text}
  </p>
);

/**
 * One row of 48px: the month before with the move ("September 73% · down 3 points", an arrow icon as well as the words, never colour alone) and, at its right, the words
 * "Last six months" that open a table. The whole row is the control (a native details, so it works without a script); the table takes the full width below it. Months
 * with no figure are left out of the table.
 */
function History({ previous, trend }: { previous: PreviousLine | null; trend: readonly TrendPoint[] }) {
  const known = trend.filter((p): p is { label: string; value: number } => p.value !== null);
  const compare = previous === null ? null : (
    <span className="tnum flex min-w-0 flex-wrap items-center gap-x-1 text-caption text-ink-2">
      <span>{t("committee.card.prevJoin", { previous: previous.text })}</span>
      <span className="inline-flex items-center gap-1">
        {previous.direction === "up" && <ArrowUpIcon size={16} />}
        {previous.direction === "down" && <ArrowDownIcon size={16} />}
        {previous.change}
      </span>
    </span>
  );
  if (known.length === 0) return <div className="flex min-h-12 items-center">{compare}</div>;
  return (
    <details>
      <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3">
        {compare}
        <span className="shrink-0 text-caption font-semibold text-accent underline underline-offset-4">{t("committee.card.lastSix")}</span>
      </summary>
      <table className="tnum w-full text-left text-caption">
        <caption className="sr-only">{t("committee.card.lastSix")}</caption>
        <thead>
          <tr className="border-b-2 border-ink">
            <th scope="col" className="py-1 pr-4 font-semibold">
              {t("committee.trend.col.period")}
            </th>
            <th scope="col" className="py-1 pl-4 text-right font-semibold">
              {t("committee.trend.col.share")}
            </th>
          </tr>
        </thead>
        <tbody>
          {known.map((p) => (
            <tr key={p.label} className="border-b border-hairline">
              <th scope="row" className="py-1 pr-4 font-normal">
                {p.label}
              </th>
              <td className="py-1 pl-4 text-right">{t("committee.percent", { n: p.value })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * The four headline cards, always shown and never hideable, in one anatomy: a title row (with Met or Not met where a goal exists), the large value, ONE visual (a goal bar,
 * a progress bar, or none), and at most three small lines. Four across from 1280px, two by two from 768px, one column below.
 */
export function HeadlineCards({ report }: { report: CommitteeReport }) {
  const { cards, money } = report;
  const month = monthName(report.period);
  const [onTimeGoal, replyGoal, reopenGoal] = report.goals.rows;
  return (
    <section aria-label={t("committee.cards.label")}>
      <ul className="grid list-none gap-3 p-0 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
        <Card label={t("committee.card.collected", { month })} period={t("committee.card.period.bills", { month })} phonePeriod={false} value={cards.collected.value}>
          <GoalBar value={cards.collected.percent} label={collectedBarLabel(cards.collected, money)} />
          <p className="tnum text-caption text-ink-2">{cards.collected.comparison}</p>
          {cards.collected.sameAge !== null && <p className="tnum text-caption text-ink-2">{cards.collected.sameAge}</p>}
        </Card>
        <Card label={t("committee.card.owed")} period={t("committee.card.period.owed", { date: dateWords(report.asOf) })} phonePeriod value={cards.owed.value}>
          <p className="tnum text-caption text-ink-2">{t("committee.card.owedLine", { flats: cards.owed.comparison, over90: cards.owed.detail })}</p>
          <p className="tnum text-caption text-ink-2">{cards.owed.split}</p>
        </Card>
        <Card
          label={t("committee.card.onTime", { month })}
          period={t("committee.card.period.bills", { month })}
          phonePeriod={false}
          tag={<GoalTag status={cards.onTime.goal.status} />}
          value={cards.onTime.value}
          note={<GoalLine mark={cards.onTime.goal} />}
        >
          <GoalBar value={cards.onTime.percent} goal={cards.onTime.goal.targetPercent} direction="higher" label={goalBarLabel(cards.onTime.percent, cards.onTime.goal)} />
          <History previous={cards.onTime.previous} trend={cards.onTime.trend} />
        </Card>
        <Card
          label={t("committee.card.sla", { month })}
          period={t("committee.card.period.complaints", { month })}
          phonePeriod={false}
          tag={<GoalTag status={cards.sla.goal.status} />}
          value={cards.sla.value}
          note={<GoalLine mark={cards.sla.goal} />}
        >
          <GoalBar value={cards.sla.percent} goal={cards.sla.goal.targetPercent} direction="higher" label={goalBarLabel(cards.sla.percent, cards.sla.goal)} />
          <History previous={cards.sla.previous} trend={cards.sla.trend} />
        </Card>
      </ul>
      <p className="pt-3">
        <a href="#about" className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4">
          {t("committee.words.pointer")}
        </a>
      </p>
      {report.goals.source === "DEFAULT" && <p className="text-body text-ink-2">{t("committee.goals.default", { a: onTimeGoal.targetPercent, b: replyGoal.targetPercent, c: reopenGoal.targetPercent })}</p>}
    </section>
  );
}
