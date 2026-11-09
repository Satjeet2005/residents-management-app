import Link from "next/link";
import { TableToggle } from "@/components/charts/chart-parts";
import { cx } from "@/components/ui/cx";
import { Money } from "@/components/ui/money";
import { formatRupees } from "@/domain/money/money";
import type { AgeBucket, Ageing } from "@/domain/reports/age";
import type { MoneyLine } from "@/domain/reports/money-line";
import type { CalendarDate } from "@/domain/time/calendar";
import { t } from "@/lib/messages";
import { ageingTableOf, barWidthPercent, billsText, bucketLabel, bucketQuery, listedBuckets, reconcileNote, shareOfTotal } from "@/lib/reports/ageing";
import { countText } from "@/lib/reports/cards";
import { reportHref } from "@/lib/reports/period";

/**
 * What is owed as of the business date: ALL open dues of ALL months, said so in the text. The total with its split (unpaid bills plus late fees), the number of
 * different flats, and ONE list of the age groups (D180): each row has its label, a bar scaled to the TOTAL so the bars compare, its amount, its bills, its share of
 * the total and the link "See the flats" to its drill-down (set beside the bar: nothing in a bar is tappable). "Not yet due" is left out when it is empty. The
 * numbers behind the list are one tap away, and a sentence ties the month's "Still unpaid" to the groups.
 */
export function AgeingBlock({ ageing, money, period, selected }: { ageing: Ageing; money: MoneyLine | null; period: CalendarDate; selected: AgeBucket | null }) {
  const note = reconcileNote({ ageing, money, period });
  return (
    <>
      <p className="text-body text-ink-2">{t("committee.ageing.scope")}</p>
      <div data-figure="owedTotal" className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-body font-semibold">{t("committee.ageing.total")}</span>
          <Money amount={ageing.total.amountDuePaise} size="large" />
        </div>
        {ageing.total.bills > 0 && (
          <p className="tnum text-body">
            {t("committee.ageing.split", { total: formatRupees(ageing.total.amountDuePaise), bills: formatRupees(ageing.total.unpaidBillsPaise), fees: formatRupees(ageing.total.lateFeesPaise) })}
          </p>
        )}
        {ageing.total.bills > 0 && <p className="tnum text-body text-ink-2">{ageing.total.flats === 1 ? t("committee.ageing.flatsTotalOne") : t("committee.ageing.flatsTotal", { n: countText(ageing.total.flats) })}</p>}
      </div>
      {note !== null && <p className="tnum text-body">{note}</p>}
      {ageing.total.bills === 0 ? (
        <p className="text-body">{t("committee.ageing.empty")}</p>
      ) : (
        <>
          <ul data-figure="ageGroups" className="flex list-none flex-col p-0">
            {listedBuckets(ageing).map((b) => {
              const width = barWidthPercent(b.amountDuePaise, ageing);
              const share = shareOfTotal(b.amountDuePaise, ageing);
              return (
                <li key={b.bucket} className="flex flex-col gap-1 border-b border-hairline py-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className={cx("text-body", selected === b.bucket && "font-semibold")}>{bucketLabel(b.bucket)}</span>
                    <Money amount={b.amountDuePaise} size="strong" />
                  </div>
                  <div aria-hidden="true" className="h-3.5 w-full rounded-control border-2 border-hairline bg-paper">
                    {width > 0 && <div className={cx("h-full", b.bucket === "OVER_90" ? "bg-caution/40 border-r-2 border-caution" : "bg-accent")} style={{ width: `${width}%` }} />}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4">
                    <span className="tnum text-body text-ink-2">
                      {billsText(b.bills)}
                      {share !== null && ` · ${t("committee.ageing.share", { n: share })}`}
                    </span>
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
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-body text-ink-2">{t("committee.ageing.flatNote")}</p>
          <TableToggle table={ageingTableOf(ageing)} />
        </>
      )}
    </>
  );
}
