import { ProgressBar } from "@/components/charts/progress-bar";
import { Sparkline } from "@/components/charts/sparkline";
import { t } from "@/lib/messages";
import { collectedBarText, trendText } from "@/lib/reports/visuals";
import type { CommitteeReport } from "@/server/reports/report-data";
import { GoalLine } from "./goal-mark";

function Card({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-control border border-hairline p-4">
      <h2 className="text-body font-semibold">{label}</h2>
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
  return (
    <section aria-label={t("committee.cards.label")}>
      <ul className="grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-4">
        <Card label={t("committee.card.collected")} value={cards.collected.value}>
          <p className="text-body text-ink-2">{cards.collected.comparison}</p>
          {cards.collected.exact !== null && <p className="tnum text-caption text-ink-2">{cards.collected.exact}</p>}
          <ProgressBar text={collectedBarText(cards.collected, money)} percent={cards.collected.percent} />
        </Card>
        <Card label={t("committee.card.owed")} value={cards.owed.value}>
          <p className="text-body text-ink-2">{cards.owed.comparison}</p>
          <p className="text-body text-ink-2">{cards.owed.detail}</p>
        </Card>
        <Card label={t("committee.card.onTime")} value={cards.onTime.value}>
          <GoalLine mark={cards.onTime.goal} />
          {cards.onTime.lastMonth !== null && <p className="text-body text-ink-2">{cards.onTime.lastMonth}</p>}
          <Sparkline
            text={trendText({ id: "m2-on-time", caption: t("committee.card.onTime"), title: t("committee.trend.onTime.title"), points: cards.onTime.trend, goal: cards.onTime.goal })}
            points={cards.onTime.trend}
            goal={{ percent: cards.onTime.goal.targetPercent, label: t("committee.sparkline.goal", { n: cards.onTime.goal.targetPercent }) }}
          />
        </Card>
        <Card label={t("committee.card.sla")} value={cards.sla.value}>
          <GoalLine mark={cards.sla.goal} />
          {cards.sla.lastMonth !== null && <p className="text-body text-ink-2">{cards.sla.lastMonth}</p>}
          <Sparkline
            text={trendText({ id: "m2-sla", caption: t("committee.card.sla"), title: t("committee.trend.sla.title"), points: cards.sla.trend, goal: cards.sla.goal })}
            points={cards.sla.trend}
            goal={{ percent: cards.sla.goal.targetPercent, label: t("committee.sparkline.goal", { n: cards.sla.goal.targetPercent }) }}
          />
        </Card>
      </ul>
    </section>
  );
}
