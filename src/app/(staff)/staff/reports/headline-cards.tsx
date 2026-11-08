import { ProgressBar } from "@/components/charts/progress-bar";
import { Sparkline } from "@/components/charts/sparkline";
import { t } from "@/lib/messages";
import { monthName } from "@/lib/format-date";
import { dateWords } from "@/lib/reports/period";
import { collectedBarText, trendText } from "@/lib/reports/visuals";
import type { CommitteeReport } from "@/server/reports/report-data";
import { GoalLine } from "./goal-mark";

function Card({ label, period, value, children }: { label: string; period: string; value: string; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-control border border-hairline p-4">
      <h2 className="text-body font-semibold">{label}</h2>
      <p className="text-caption text-ink-2">{period}</p>
      <p className="tnum text-hero font-semibold">{value}</p>
      {children}
    </li>
  );
}

/**
 * The four headline cards, always shown and never hideable: Collected this month (a progress bar, no goal because none exists), Total owed, Paid on time (goal and a
 * six-month sparkline) and Replies within the SLA (goal and an eight-week sparkline). Each is a label, one large value, a comparison line and a mark.
 * Four across from 1280px, two by two from 768px, one column below.
 */
export function HeadlineCards({ report }: { report: CommitteeReport }) {
  const { cards, money } = report;
  const month = monthName(report.period);
  const [onTimeGoal, replyGoal, reopenGoal] = report.goals.rows;
  return (
    <section aria-label={t("committee.cards.label")}>
      <ul className="grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-4">
        <Card label={t("committee.card.collected", { month })} period={t("committee.card.period.bills", { month })} value={cards.collected.value}>
          <p className="text-body text-ink-2">{cards.collected.comparison}</p>
          {cards.collected.exact !== null && <p className="tnum text-caption text-ink-2">{cards.collected.exact}</p>}
          {cards.collected.within20 !== null && <p className="text-body text-ink-2">{cards.collected.within20}</p>}
          {cards.collected.sameAge !== null && <p className="text-body text-ink-2">{cards.collected.sameAge}</p>}
          <ProgressBar text={collectedBarText(cards.collected, money)} percent={cards.collected.percent} />
        </Card>
        <Card label={t("committee.card.owed")} period={t("committee.card.period.owed", { date: dateWords(report.asOf) })} value={cards.owed.value}>
          <p className="text-body text-ink-2">{cards.owed.comparison}</p>
          <p className="text-body text-ink-2">{cards.owed.detail}</p>
        </Card>
        <Card label={t("committee.card.onTime", { month })} period={t("committee.card.period.bills", { month })} value={cards.onTime.value}>
          {cards.onTime.percent !== null && <p className="text-body text-ink-2">{t("committee.card.onTimeCaption", { n: cards.onTime.percent, month })}</p>}
          <GoalLine mark={cards.onTime.goal} />
          {cards.onTime.lastMonth !== null && <p className="text-body text-ink-2">{cards.onTime.lastMonth}</p>}
          <Sparkline
            text={trendText({ id: "m2-on-time", caption: t("committee.trend.onTime.title"), title: t("committee.trend.onTime.title"), points: cards.onTime.trend, goal: cards.onTime.goal })}
            points={cards.onTime.trend}
            goal={{ percent: cards.onTime.goal.targetPercent, label: t("committee.sparkline.goal", { n: cards.onTime.goal.targetPercent }) }}
          />
        </Card>
        <Card label={t("committee.card.sla", { month })} period={t("committee.card.period.complaints", { month })} value={cards.sla.value}>
          <GoalLine mark={cards.sla.goal} />
          {cards.sla.lastMonth !== null && <p className="text-body text-ink-2">{cards.sla.lastMonth}</p>}
          <Sparkline
            text={trendText({ id: "m2-sla", caption: t("committee.trend.sla.title"), title: t("committee.trend.sla.title"), points: cards.sla.trend, goal: cards.sla.goal })}
            points={cards.sla.trend}
            goal={{ percent: cards.sla.goal.targetPercent, label: t("committee.sparkline.goal", { n: cards.sla.goal.targetPercent }) }}
          />
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
