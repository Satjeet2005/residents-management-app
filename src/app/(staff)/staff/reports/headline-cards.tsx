import { Support } from "@/components/committee/support";
import { GoalBar } from "@/components/charts/goal-bar";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/icons";
import { t } from "@/lib/messages";
import { monthName } from "@/lib/format-date";
import { type GoalMark, type PreviousLine, type TrendPoint, goalBarLabel } from "@/lib/reports/cards";
import { collectedBarLabel } from "@/lib/reports/visuals";
import type { CommitteeReport } from "@/server/reports/report-data";
import { GoalTag, TickGlyph } from "./goal-mark";

/**
 * One card is one block: its title row (with Met or Not met where a goal exists), the large value, ONE visual and at most three small lines. `figure` is the
 * registry id of the figure it shows, so the page's expander defines it. `note` sits beside the large value on one baseline (the goal words of a goal card).
 */
function Card({ label, figure, tag, value, note, children }: { label: string; figure: string; tag?: React.ReactNode; value: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li data-block="" data-figure={figure} className="flex min-w-0 flex-col gap-1 rounded-control border border-hairline p-3 md:p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-body font-semibold">{label}</h2>
        {tag}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="tnum text-hero font-semibold">{value}</p>
        {note}
      </div>
      {children}
    </li>
  );
}

/** "<tick> Goal 90% · 20 points short": the one place the goal is written on a card. It is a goal line, so the text budget leaves it out. */
const GoalLine = ({ mark }: { mark: GoalMark }) => (
  <p data-goal="" className="tnum text-caption text-ink-2">
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
    <Support as="span" small className="tnum flex min-w-0 flex-wrap items-center gap-x-1">
      <span>{t("committee.card.prevJoin", { previous: previous.text })}</span>
      <span className="inline-flex items-center gap-1">
        {previous.direction === "up" && <ArrowUpIcon size={16} />}
        {previous.direction === "down" && <ArrowDownIcon size={16} />}
        {previous.change}
      </span>
    </Support>
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
  return (
    <section aria-label={t("committee.cards.label")}>
      <ul className="grid list-none gap-3 p-0 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
        <Card label={t("committee.card.collected", { month })} figure="cardCollected" value={cards.collected.value}>
          <GoalBar value={cards.collected.percent} label={collectedBarLabel(cards.collected, money)} />
          <Support small className="tnum">{cards.collected.comparison}</Support>
          {cards.collected.sameAge !== null && <Support small className="tnum">{cards.collected.sameAge}</Support>}
        </Card>
        <Card label={t("committee.card.owed")} figure="cardOwed" value={cards.owed.value}>
          <Support small className="tnum">{t("committee.card.owedLine", { flats: cards.owed.comparison, over90: cards.owed.detail })}</Support>
          <Support small className="tnum">{cards.owed.split}</Support>
        </Card>
        <Card label={t("committee.card.onTime", { month })} figure="cardOnTime" tag={<GoalTag status={cards.onTime.goal.status} />} value={cards.onTime.value} note={<GoalLine mark={cards.onTime.goal} />}>
          <GoalBar value={cards.onTime.percent} goal={cards.onTime.goal.targetPercent} direction="higher" label={goalBarLabel(cards.onTime.percent, cards.onTime.goal)} />
          <History previous={cards.onTime.previous} trend={cards.onTime.trend} />
        </Card>
        <Card label={t("committee.card.sla", { month })} figure="cardReplied" tag={<GoalTag status={cards.sla.goal.status} />} value={cards.sla.value} note={<GoalLine mark={cards.sla.goal} />}>
          <GoalBar value={cards.sla.percent} goal={cards.sla.goal.targetPercent} direction="higher" label={goalBarLabel(cards.sla.percent, cards.sla.goal)} />
          <History previous={cards.sla.previous} trend={cards.sla.trend} />
        </Card>
      </ul>
    </section>
  );
}
