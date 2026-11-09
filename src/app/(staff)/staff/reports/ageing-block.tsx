import Link from "next/link";
import { DataTable } from "@/components/committee/data-table";
import { Support } from "@/components/committee/support";
import { cx } from "@/components/ui/cx";
import { Money } from "@/components/ui/money";
import { formatRupees } from "@/domain/money/money";
import type { Ageing } from "@/domain/reports/age";
import { t } from "@/lib/messages";
import { ageingTableOf, barWidthPercent, bucketLabel, flatsHref, groupShares, listedBuckets, rowCountText } from "@/lib/reports/ageing";
import { flatsText } from "@/lib/reports/cards";

/** "Total owed": the figure, ONE line that splits it ("Unpaid bills ₹x + late fees ₹y", the total is not said again) and the number of different flats ("838 flats"). */
export function TotalBlock({ ageing }: { ageing: Ageing }) {
  const { total } = ageing;
  return (
    <section data-block="" aria-labelledby="committee-total" className="flex flex-col gap-1">
      <div data-figure="owedTotal" className="flex items-baseline justify-between gap-4">
        <h2 id="committee-total" className="text-title font-semibold">
          {t("committee.ageing.total")}
        </h2>
        <Money amount={total.amountDuePaise} size="large" />
      </div>
      {total.bills === 0 ? (
        <p className="text-body">{t("committee.ageing.empty")}</p>
      ) : (
        <>
          <Support className="tnum">{t("committee.ageing.split", { bills: formatRupees(total.unpaidBillsPaise), fees: formatRupees(total.lateFeesPaise) })}</Support>
          <Support className="tnum">{flatsText(total.flats)}</Support>
        </>
      )}
    </section>
  );
}

/**
 * "How old are the dues?" (D214): ONE list of the age groups, each with its label, a bar scaled to the TOTAL so the bars compare, its amount, one grey line (its bills,
 * or the flats for "Over 90 days", and its share of the total, the shares adding to 100) and the link "See the flats" (set beside the bar: nothing in a bar is tappable).
 * "See the flats" opens the flats page of the group (D217), never an inline list. "Not yet due" is left out when it is empty. The numbers behind the list are one real table, four columns on a phone, with a total row. Nothing here when nothing is owed.
 */
export function AgeBlock({ ageing }: { ageing: Ageing }) {
  if (ageing.total.bills === 0) return null;
  const shares = groupShares(ageing);
  const table = ageingTableOf(ageing);
  return (
    <section data-block="" aria-labelledby="committee-age" className="flex flex-col gap-2">
      <h2 id="committee-age" className="text-title font-semibold">
        {t("committee.ageing.heading")}
      </h2>
      <ul data-figure="ageGroups" className="flex list-none flex-col p-0">
        {listedBuckets(ageing).map((b) => {
          const width = barWidthPercent(b.amountDuePaise, ageing);
          return (
            <li key={b.bucket} className="flex flex-col gap-1 border-b border-hairline py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-body">{bucketLabel(b.bucket)}</span>
                <Money amount={b.amountDuePaise} size="strong" />
              </div>
              <div aria-hidden="true" className="h-3.5 w-full rounded-control border-2 border-hairline bg-paper">
                {width > 0 && <div className={cx("h-full", b.bucket === "OVER_90" ? "bg-caution/40 border-r-2 border-caution" : "bg-accent")} style={{ width: `${width}%` }} />}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4">
                <Support as="span" className="tnum">
                  {t("committee.ageing.line", { count: rowCountText(b.bucket, b), share: shares[b.bucket] })}
                </Support>
                {b.bills > 0 && (
                  <Link
                    href={flatsHref(b.bucket)}
                    aria-label={t("committee.ageing.seeLabel", { bucket: bucketLabel(b.bucket) })}
                    className="inline-flex min-h-12 items-center text-body font-semibold text-accent underline underline-offset-4"
                  >
                    {t("committee.ageing.see")}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <details>
        <summary className="flex min-h-12 cursor-pointer items-center text-body font-semibold text-accent underline underline-offset-4">{t("committee.chart.table")}</summary>
        <DataTable caption={table.caption} columns={table.columns} rows={table.rows} captionVisible />
      </details>
    </section>
  );
}
