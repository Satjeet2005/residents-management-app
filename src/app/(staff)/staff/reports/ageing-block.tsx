import Link from "next/link";
import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { cx } from "@/components/ui/cx";
import { Money } from "@/components/ui/money";
import type { AgeBucket, Ageing } from "@/domain/reports/age";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { bucketLabel, bucketQuery } from "@/lib/reports/ageing";
import { reportHref } from "@/lib/reports/period";
import { ageingVisual } from "@/lib/reports/visuals";

/**
 * What is owed as of the business date: ALL open dues of ALL months, said so in the text. The total with its flats and bills, then the five age groups as bars
 * of amount due at every width (M4, which is also the ageing chart); each age group with bills has a "See the flats" link to its drill-down, set beside the chart
 * and not inside it (nothing in a chart is tappable). The groups' amounts add up to the total exactly.
 */
export function AgeingBlock({ ageing, period, selected }: { ageing: Ageing; period: CalendarDate; selected: AgeBucket | null }) {
  const visual = ageingVisual(ageing);
  return (
    <>
      <p className="text-body text-ink-2">{t("committee.ageing.scope")}</p>
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-body font-semibold">{t("committee.ageing.total")}</span>
          <span className="text-caption text-ink-2">{t("committee.ageing.counts", { flats: ageing.total.flats, bills: ageing.total.bills })}</span>
        </span>
        <Money amount={ageing.total.amountDuePaise} size="large" />
      </div>
      {ageing.total.bills === 0 ? <p className="text-body">{t("committee.ageing.empty")}</p> : <HorizontalBars text={visual.text} rows={visual.rows} />}
      <ul className="flex flex-col">
        {ageing.buckets
          .filter((b) => b.bills > 0)
          .map((b) => (
            <li key={b.bucket} className="flex flex-wrap items-center justify-between gap-x-4 border-b border-hairline">
              <span className="flex flex-col py-2">
                <span className={cx("text-body", selected === b.bucket && "font-semibold")}>{bucketLabel(b.bucket)}</span>
                <span className="text-caption text-ink-2">{t("committee.ageing.counts", { flats: b.flats, bills: b.bills })}</span>
              </span>
              <Link
                href={reportHref({ period, bucket: bucketQuery(b.bucket) })}
                aria-label={t("committee.ageing.seeLabel", { bucket: bucketLabel(b.bucket) })}
                aria-current={selected === b.bucket ? "true" : undefined}
                className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4 aria-[current=true]:text-ink"
              >
                {t("committee.ageing.see")}
              </Link>
            </li>
          ))}
      </ul>
    </>
  );
}
