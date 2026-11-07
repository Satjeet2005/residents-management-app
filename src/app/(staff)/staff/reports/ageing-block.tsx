import Link from "next/link";
import { Money } from "@/components/ui/money";
import { cx } from "@/components/ui/cx";
import { DoubleRule } from "@/components/ui/rules";
import type { AgeBucket, Ageing } from "@/domain/reports/age";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { ageingWidths, bucketLabel, bucketQuery } from "@/lib/reports/ageing";
import { reportHref } from "@/lib/reports/period";

/** How each bucket looks. The pattern and colour only add to the label and the numbers printed beside it: they never carry the meaning. */
const SWATCH: Record<AgeBucket, string> = {
  NOT_YET_DUE: "bg-paper border-control",
  DAYS_1_30: "bg-paper-2 border-ink",
  DAYS_31_60: "bg-hairline border-ink",
  DAYS_61_90: "bg-accent border-accent",
  OVER_90: "bg-caution border-caution",
};

/**
 * What is owed as of the business date: ALL open dues of ALL months, said so in the label. A segmented bar made of plain elements (the widths are whole
 * percents of the amount due and add up to 100), and under it each age group with its flats, bills and amount due. The groups' amounts add up to the total
 * exactly. Each group links to its drill-down (the flats, oldest first).
 */
export function AgeingBlock({ ageing, period, selected }: { ageing: Ageing; period: CalendarDate; selected: AgeBucket | null }) {
  const widths = ageingWidths(ageing.buckets.map((b) => b.amountDuePaise));
  return (
    <section aria-labelledby="committee-ageing" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="committee-ageing" className="text-title font-semibold">
          {t("committee.ageing.heading")}
        </h2>
        <p className="text-body text-ink-2">{t("committee.ageing.scope")}</p>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-body font-semibold">{t("committee.ageing.total")}</span>
          <span className="text-caption text-ink-2">{t("committee.ageing.counts", { flats: ageing.total.flats, bills: ageing.total.bills })}</span>
        </span>
        <Money amount={ageing.total.amountDuePaise} size="large" />
      </div>
      {ageing.total.bills === 0 ? (
        <p className="text-body">{t("committee.ageing.empty")}</p>
      ) : (
        <div aria-hidden="true" className="flex h-4 w-full overflow-hidden rounded-control border border-ink">
          {ageing.buckets.map((b, index) =>
            widths[index] === 0 ? null : <div key={b.bucket} style={{ width: `${widths[index]}%` }} className={cx("h-full border-r", SWATCH[b.bucket])} />,
          )}
        </div>
      )}
      <DoubleRule />
      <ul className="flex flex-col">
        {ageing.buckets.map((b) => (
          <li key={b.bucket} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline py-2">
            <span className="flex min-w-0 items-center gap-2 text-body">
              <span aria-hidden="true" className={cx("h-4 w-4 shrink-0 rounded-control border-2", SWATCH[b.bucket])} />
              <span className="flex flex-col">
                <span className={cx(selected === b.bucket && "font-semibold")}>{bucketLabel(b.bucket)}</span>
                <span className="text-caption text-ink-2">{t("committee.ageing.counts", { flats: b.flats, bills: b.bills })}</span>
              </span>
            </span>
            <span className="flex items-center gap-4">
              <Money amount={b.amountDuePaise} size="strong" />
              {b.bills > 0 && (
                <Link
                  href={reportHref({ period, bucket: bucketQuery(b.bucket) })}
                  aria-label={t("committee.ageing.seeLabel", { bucket: bucketLabel(b.bucket) })}
                  aria-current={selected === b.bucket ? "true" : undefined}
                  className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4 aria-[current=true]:text-ink"
                >
                  {t("committee.ageing.see")}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
